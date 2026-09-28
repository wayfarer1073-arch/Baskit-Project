import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';
import type { ParsedInventoryRow } from '@/domain/excel/types';
import { readLots, type CountLot, type PeriodicCountEntry, type RecentCountSku } from '@/domain/segments/read-model';
import type { SkuDescriptor } from '@/domain/inventory/read-model';
import { createSnapshot } from '@/server/repositories/snapshot-repository';

/** 직접 입력한 실사가 들어간 스냅샷의 파일명 자리 표시. */
export const MANUAL_COUNT_SOURCE = '직접 입력';

const toDateOnly = (date: string) => new Date(`${date}T00:00:00.000Z`);

function isManualLine(extra: unknown) {
  return !!extra && typeof extra === 'object' && (extra as { manual?: unknown }).manual === true;
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
  const warehouse = await prisma.warehouse.findFirst({ where: { id: input.warehouseId, organizationId: orgId, isArchived: false } });
  if (!warehouse) return null;

  const snapshotDate = toDateOnly(input.date);
  const existing = await prisma.inventorySnapshot.findFirst({
    where: { warehouseId: input.warehouseId, snapshotDate, status: 'ACTIVE' },
    include: { items: true },
  });
  const knownSkus = await prisma.sku.findMany({ where: { warehouseId: input.warehouseId, productCode: { in: input.lines.map((l) => l.productCode) } } });
  const skuByCode = new Map(knownSkus.map((s) => [s.productCode, s]));

  const rows = new Map<string, ParsedInventoryRow>();
  for (const item of existing?.items ?? []) {
    rows.set(item.productCode, {
      rowNumber: rows.size + 1,
      productCode: item.productCode,
      productName: item.productName,
      option: item.option,
      barcode: item.barcode,
      location: item.location,
      category: item.category,
      unitCost: Number(item.unitCost),
      costMissing: !item.unitCostProvided,
      totalCost: item.totalCost === null ? null : Number(item.totalCost),
      normalStock: item.normalStock,
      availableStock: item.availableStock,
      incomingStock: item.incomingStock,
      defectiveStock: item.defectiveStock,
      warningQty: item.warningQty,
      dangerQty: item.dangerQty,
      extra: item.extra && typeof item.extra === 'object' && !Array.isArray(item.extra) ? (item.extra as Record<string, unknown>) : {},
    });
  }
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

/** 창고에서 최근에 센 순으로 상품과 마지막 실사 값(수량·원가·롯트). */
export async function listRecentCountedSkus(orgId: string, warehouseId: string, limit = 300): Promise<RecentCountSku[]> {
  const skus = await prisma.sku.findMany({
    where: { warehouseId, warehouse: { organizationId: orgId }, isHiddenFromDashboard: false },
    orderBy: [{ lastSeenDate: 'desc' }, { productCode: 'asc' }],
    take: limit,
    include: {
      items: {
        where: { snapshot: { status: 'ACTIVE' } },
        orderBy: { snapshot: { snapshotDate: 'desc' } },
        take: 1,
        select: { normalStock: true, unitCost: true, unitCostProvided: true, extra: true, snapshot: { select: { snapshotDate: true } } },
      },
    },
  });
  return skus.map((s) => {
    const last = s.items[0];
    return {
      skuId: s.id,
      productCode: s.productCode,
      productName: s.currentProductName,
      lastCountDate: last ? dateOnlyToString(last.snapshot.snapshotDate) : null,
      lastQuantity: last ? last.normalStock : null,
      unitCost: Number(s.currentUnitCost) > 0 ? Number(s.currentUnitCost) : null,
      lots: last ? readLots(last.extra) : [],
    };
  });
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
      warehouse: { organizationId: orgId, isArchived: false },
      isHiddenFromDashboard: false,
      firstSeenDate: { lte: asOf },
      ...(skuId ? { id: skuId } : { OR: [{ isActive: true }, { soldOutDetectedDate: { gt: asOf } }] }),
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
