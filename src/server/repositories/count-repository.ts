import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';
import type { ParsedInventoryRow } from '@/domain/excel/types';
import { readLots, type CountLot, type CountSheetRow, type PeriodicCountEntry } from '@/domain/segments/read-model';
import type { SkuDescriptor } from '@/domain/inventory/read-model';
import { createSnapshot } from '@/server/repositories/snapshot-repository';
import { attributesAt, loadSkuAttributeHistory, type SkuAttributes } from '@/server/repositories/sku-attribute-repository';

/** 직접 입력한 실사가 들어간 스냅샷의 파일명 자리 표시. */
export const MANUAL_COUNT_SOURCE = '직접 입력';

const toDateOnly = (date: string) => new Date(`${date}T00:00:00.000Z`);

function isManualLine(extra: unknown) {
  return !!extra && typeof extra === 'object' && (extra as { manual?: unknown }).manual === true;
}

const storedItemInclude = {
  sku: {
    select: {
      productCode: true,
      currentProductName: true,
      currentOption: true,
      currentBarcode: true,
      currentLocation: true,
      currentWarningQty: true,
      currentDangerQty: true,
    },
  },
} satisfies Prisma.InventoryItemInclude;

type StoredItem = Prisma.InventoryItemGetPayload<{ include: typeof storedItemInclude }>;

/** 저장된 실사 줄을 다시 저장할 수 있는 행으로 되돌린다(같은 날 새 버전을 만들 때 기존 줄을 옮겨 담는 용도). */
function itemToRow(item: StoredItem, attributes: SkuAttributes, rowNumber: number): ParsedInventoryRow {
  return {
    rowNumber,
    productCode: item.sku.productCode,
    productName: attributes.productName,
    option: attributes.option,
    barcode: attributes.barcode,
    location: attributes.location,
    category: null,
    unitCost: Number(item.unitCost),
    costMissing: !item.unitCostProvided,
    totalCost: item.totalCost === null ? null : Number(item.totalCost),
    normalStock: item.normalStock,
    availableStock: item.normalStock,
    incomingStock: item.incomingStock,
    defectiveStock: item.defectiveStock,
    warningQty: attributes.warningQty,
    dangerQty: attributes.dangerQty,
    extra: item.extra && typeof item.extra === 'object' && !Array.isArray(item.extra) ? (item.extra as Record<string, unknown>) : {},
  };
}

/** 그 날짜 스냅샷의 줄들을 다시 저장할 행으로 — 상품 속성은 그날 효력 있던 값(없으면 지금 값). */
async function itemsToRows(items: StoredItem[], snapshotDate: Date): Promise<ParsedInventoryRow[]> {
  const date = dateOnlyToString(snapshotDate);
  const history = await loadSkuAttributeHistory(items.map((i) => i.skuId), date);
  return items.map((item, index) => {
    const current: SkuAttributes = {
      productName: item.sku.currentProductName,
      option: item.sku.currentOption,
      barcode: item.sku.currentBarcode,
      location: item.sku.currentLocation,
      warningQty: item.sku.currentWarningQty,
      dangerQty: item.sku.currentDangerQty,
    };
    return itemToRow(item, attributesAt(history.get(item.skuId), date) ?? current, index + 1);
  });
}

/**
 * 그 날짜 실사에서 직접 입력한 줄. 같은 날 엑셀을 다시 올려 교체할 때, 엑셀에 없는 직접 입력 상품은 사라지지 않게
 * 이 줄들을 새 버전에 합쳐 넣는다(엑셀에 같은 상품이 있으면 엑셀 값이 이긴다).
 */
export async function manualRowsForDate(warehouseId: string, snapshotDate: Date): Promise<ParsedInventoryRow[]> {
  const snapshot = await prisma.inventorySnapshot.findFirst({ where: { warehouseId, snapshotDate, status: 'ACTIVE' }, include: { items: { include: storedItemInclude } } });
  return itemsToRows((snapshot?.items ?? []).filter((i) => isManualLine(i.extra)), snapshotDate);
}

export interface MissingSku {
  productCode: string;
  productName: string;
}

/**
 * 이 목록(엑셀)을 그 날짜로 올리면 품절로 처리될 기존 SKU — 지금 재고가 있다고 보는 SKU 중 파일에 없는 것.
 * 같은 날 직접 입력한 상품은 합쳐서 남기므로 빼고, 그 날짜보다 뒤의 실사가 이미 있으면 품절 처리를 하지 않으므로 빈 목록이다.
 */
export async function skusMissingFromUpload(warehouseId: string, snapshotDate: Date, fileCodes: string[]): Promise<MissingSku[]> {
  const later = await prisma.inventorySnapshot.findFirst({ where: { warehouseId, status: 'ACTIVE', snapshotDate: { gt: snapshotDate } }, select: { id: true } });
  if (later) return [];
  const kept = new Set([...fileCodes, ...(await manualRowsForDate(warehouseId, snapshotDate)).map((r) => r.productCode)]);
  const active = await prisma.sku.findMany({
    where: { warehouseId, isActive: true, isHiddenFromDashboard: false },
    orderBy: { productCode: 'asc' },
    select: { productCode: true, currentProductName: true },
  });
  return active.filter((s) => !kept.has(s.productCode)).map((s) => ({ productCode: s.productCode, productName: s.currentProductName }));
}

export interface CountLineInput {
  productCode: string;
  productName: string;
  /** 롯트를 적었으면 롯트 합계로 다시 계산한다. */
  quantity: number;
  /** 비우면 직전 실사의 원가를 이어받는다. */
  unitCost: number | null;
  lots: CountLot[];
}

/**
 * 직접 센 수량을 그 날짜의 실사로 기록한다.
 *
 * 같은 날짜에 이미 실사(엑셀 업로드 또는 이전 직접 입력)가 있으면 그 목록에 이번 줄들을 덮어 합친 새 버전을
 * 만든다 — 같은 날 엑셀로 올린 다른 상품의 수량이 사라지지 않도록. 일부 상품만 센 것이므로 이번에 빠진
 * 상품을 품절로 보지 않는다(partial).
 */
export async function recordCounts(orgId: string, input: { warehouseId: string; date: string; lines: CountLineInput[]; userId: string }) {
  const warehouse = await prisma.warehouse.findFirst({ where: { id: input.warehouseId, organizationId: orgId, isArchived: false, kind: 'STOCK', segment: 'PERIODIC_COUNT' } });
  if (!warehouse) return null;

  const snapshotDate = toDateOnly(input.date);
  const existing = await prisma.inventorySnapshot.findFirst({
    where: { warehouseId: input.warehouseId, snapshotDate, status: 'ACTIVE' },
    include: { items: { include: storedItemInclude } },
  });
  const knownSkus = await prisma.sku.findMany({ where: { warehouseId: input.warehouseId, productCode: { in: input.lines.map((l) => l.productCode) } } });
  const skuByCode = new Map(knownSkus.map((s) => [s.productCode, s]));

  const rows = new Map<string, ParsedInventoryRow>();
  for (const row of existing ? await itemsToRows(existing.items, snapshotDate) : []) rows.set(row.productCode, row);
  for (const line of input.lines) {
    const sku = skuByCode.get(line.productCode);
    const prev = rows.get(line.productCode);
    const lots = line.lots.filter((l) => l.lot.trim() && l.quantity >= 0).map((l) => ({ lot: l.lot.trim(), quantity: l.quantity }));
    const quantity = lots.length > 0 ? lots.reduce((s, l) => s + l.quantity, 0) : line.quantity;
    rows.set(line.productCode, {
      rowNumber: prev?.rowNumber ?? rows.size + 1,
      productCode: line.productCode,
      productName: line.productName,
      option: prev?.option ?? sku?.currentOption ?? null,
      barcode: prev?.barcode ?? sku?.currentBarcode ?? null,
      location: prev?.location ?? sku?.currentLocation ?? null,
      category: prev?.category ?? null,
      unitCost: line.unitCost ?? 0,
      costMissing: line.unitCost === null,
      totalCost: null,
      normalStock: quantity,
      availableStock: quantity,
      incomingStock: 0,
      defectiveStock: 0,
      warningQty: sku?.currentWarningQty ?? 0,
      dangerQty: sku?.currentDangerQty ?? 0,
      extra: { manual: true, ...(lots.length > 0 ? { lots } : {}) },
    });
  }

  return createSnapshot({
    warehouseId: input.warehouseId,
    snapshotDate,
    sourceFileName: MANUAL_COUNT_SOURCE,
    fileHash: `manual:${Date.now()}`,
    uploadedById: input.userId,
    rows: [...rows.values()],
    replaceExisting: true,
    partial: true,
  });
}

/**
 * 직접 입력 화면의 재고 현황 표 — 창고에서 그 날짜까지 인식한 상품마다 그날 기록값과 직전 실사.
 * 그날 기록한 상품이 먼저, 그다음 최근에 센 순. 지난 날짜를 고칠 때도 같은 표를 쓴다.
 */
export async function loadCountSheet(orgId: string, warehouseId: string, date: string): Promise<CountSheetRow[] | null> {
  const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, organizationId: orgId, kind: 'STOCK', segment: 'PERIODIC_COUNT' }, select: { id: true } });
  if (!warehouse) return null;
  const day = toDateOnly(date);
  const skus = await prisma.sku.findMany({
    where: { warehouseId, isHiddenFromDashboard: false, firstSeenDate: { lte: day } },
    select: {
      id: true,
      productCode: true,
      currentProductName: true,
      currentUnitCost: true,
      isActive: true,
      items: {
        where: { snapshot: { status: 'ACTIVE', snapshotDate: { lte: day } } },
        orderBy: { snapshot: { snapshotDate: 'desc' } },
        take: 2,
        select: { normalStock: true, unitCost: true, unitCostProvided: true, extra: true, snapshot: { select: { snapshotDate: true } } },
      },
    },
  });
  const rows = skus.map((s): CountSheetRow => {
    const [first, second] = s.items;
    const firstDate = first ? dateOnlyToString(first.snapshot.snapshotDate) : null;
    const dayItem = firstDate === date ? first : null;
    const prevItem = dayItem ? second : first;
    return {
      skuId: s.id,
      productCode: s.productCode,
      productName: s.currentProductName,
      soldOut: !s.isActive,
      unitCost: Number(s.currentUnitCost) > 0 ? Number(s.currentUnitCost) : null,
      day: dayItem
        ? {
            quantity: dayItem.normalStock,
            source: isManualLine(dayItem.extra) ? 'manual' : 'excel',
            lots: readLots(dayItem.extra),
            unitCost: dayItem.unitCostProvided ? Number(dayItem.unitCost) : null,
          }
        : null,
      previous: prevItem ? { date: dateOnlyToString(prevItem.snapshot.snapshotDate), quantity: prevItem.normalStock, lots: readLots(prevItem.extra) } : null,
    };
  });
  return rows.sort(
    (a, b) =>
      Number(!!b.day) - Number(!!a.day) ||
      (b.previous?.date ?? '').localeCompare(a.previous?.date ?? '') ||
      a.productCode.localeCompare(b.productCode),
  );
}

export interface CountedSku {
  descriptor: Pick<SkuDescriptor, 'skuId' | 'warehouseId' | 'warehouseCode' | 'warehouseName' | 'productCode' | 'productName'>;
  unitCost: number | null;
  counts: PeriodicCountEntry[];
}

/**
 * 비정기 실사 대시보드용 — 한 번이라도 센 적 있는 상품 전부와 각자의 실사 이력.
 *
 * 매일 전체 목록이 들어오는 방식과 달리 날마다 일부 상품만 세므로, "가장 최근 실사에 있는 상품"이 아니라
 * 상품마다 자기 실사 이력을 쓴다. 엑셀 전체 실사에서 빠져 품절로 표시된 상품은 제외한다.
 */
export async function loadCountedSkus(orgId: string, asOfDate: string, skuId?: string): Promise<CountedSku[]> {
  const asOf = toDateOnly(asOfDate);
  // 검증용 mock 스냅샷은 실데이터가 있는 창고에서는 섞지 않는다(inventory-repository와 같은 규칙).
  const realWarehouses = await prisma.inventorySnapshot.findMany({
    where: { status: 'ACTIVE', isMock: false, warehouse: { organizationId: orgId }, snapshotDate: { lte: asOf } },
    select: { warehouseId: true },
    distinct: ['warehouseId'],
  });
  const mockFilter = { OR: [{ isMock: false }, { isMock: true, warehouseId: { notIn: realWarehouses.map((w) => w.warehouseId) } }] };
  const skus = await prisma.sku.findMany({
    where: {
      warehouse: { organizationId: orgId, isArchived: false, kind: 'STOCK', segment: 'PERIODIC_COUNT' },
      isHiddenFromDashboard: false,
      firstSeenDate: { lte: asOf },
      ...(skuId ? { id: skuId } : { OR: [{ isActive: true }, { soldOutDetectedDate: { gt: asOf } }, { removedDate: { gt: asOf } }] }),
    },
    include: {
      warehouse: { select: { id: true, code: true, name: true } },
      items: {
        where: { snapshot: { status: 'ACTIVE', snapshotDate: { lte: asOf }, ...mockFilter } },
        orderBy: { snapshot: { snapshotDate: 'asc' } },
        select: { normalStock: true, unitCost: true, unitCostProvided: true, extra: true, snapshot: { select: { snapshotDate: true } } },
      },
    },
  });
  return skus
    .filter((s) => s.items.length > 0)
    .map((s) => ({
      descriptor: {
        skuId: s.id,
        warehouseId: s.warehouseId,
        warehouseCode: s.warehouse.code,
        warehouseName: s.warehouse.name,
        productCode: s.productCode,
        productName: s.currentProductName,
      },
      unitCost: Number(s.currentUnitCost) > 0 ? Number(s.currentUnitCost) : null,
      counts: s.items.map((i) => ({
        date: dateOnlyToString(i.snapshot.snapshotDate),
        quantity: i.normalStock,
        unitCost: i.unitCostProvided ? Number(i.unitCost) : null,
        lots: readLots(i.extra),
        manual: isManualLine(i.extra),
      })),
    }));
}
