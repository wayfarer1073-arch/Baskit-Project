import { addDays, format, parseISO } from 'date-fns';
import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';
import type { StockObservation } from '@/domain/inventory/types';
import { resolveInventoryCost } from '@/domain/inventory/costs';
import type { Prisma } from '@prisma/client';
import { SOLD_OUT_VISIBLE_DAYS, type SkuDescriptor, type DailyWarehouseTotal } from '@/domain/inventory/read-model';
import type { DatedInbound } from '@/domain/inventory/inbounds';
import { observationsFromLedger, type LedgerEntry } from '@/domain/ledger/ledger';
import { NO_HOLIDAYS, type ClosedDays } from '@/domain/inventory/shipping-calendar';
import { attributesAt, loadSkuAttributeHistory, type SkuAttributes, type SkuAttributeVersionRow } from '@/server/repositories/sku-attribute-repository';

/** 창고 하나의 달력 또는 창고별 달력을 돌려주는 함수. */
type CalendarInput = ClosedDays | ((warehouseId: string) => ClosedDays);
const calendarOf = (input: CalendarInput, warehouseId: string) => (typeof input === 'function' ? input(warehouseId) : input);

/**
 * 일일 재고 연동 화면이 보는 창고 — 조직의 사용 중인(보관되지 않은) 일일 재고 연동 창고만.
 * 비정기 실사 창고와 매장 품목 가상 창고는 뺀다(비정기 실사는 count-repository가 따로 읽는다).
 */
function activeWarehouseOf(orgId: string) {
  return { organizationId: orgId, isArchived: false, kind: 'STOCK' as const, segment: 'DAILY_SYNC' as const };
}

/** 품절 인식일로부터 SOLD_OUT_VISIBLE_DAYS(180일) 뒤(유예기간 종료일, 이 날짜부터는 더 이상 노출하지 않음). */
function soldOutGraceEndDate(soldOutDetectedDateStr: string): string {
  return format(addDays(parseISO(soldOutDetectedDateStr), SOLD_OUT_VISIBLE_DAYS), 'yyyy-MM-dd');
}

/** 저장된 재고 행의 재고 0 상태(양식 설정에 따라 품절/관리 제외). 없으면 평소 품목. */
function stockStatusOf(extra: Prisma.JsonValue | null): 'soldOut' | 'removed' | null {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null;
  const status = (extra as Prisma.JsonObject).stockStatus;
  return status === 'soldOut' || status === 'removed' ? status : null;
}

/** 날짜순 관측의 끝에서부터 '재고 0 → 품절'이 이어진 첫 날짜 = 그 기준일로 본 품절 인식일. */
function trailingSoldOutStart(items: { extra: Prisma.JsonValue | null; snapshot: { snapshotDate: Date } }[]): string | null {
  let start: string | null = null;
  for (let i = items.length - 1; i >= 0 && stockStatusOf(items[i].extra) === 'soldOut'; i--) start = dateOnlyToString(items[i].snapshot.snapshotDate);
  return start;
}

/**
 * 최신 업로드 목록에서 빠져 품절로 인식됐지만(soldOutDetectedDate), asOfDate 기준 아직 180일
 * 유예기간 이내인 SKU의 id를 돌려준다. 마지막 관측 데이터가 그대로 노출되도록(휘발 방지) 하는 게
 * 목적이라 관측치 자체는 건드리지 않고, 어떤 SKU를 결과 집합에 추가로 포함할지만 결정한다.
 */
async function resolveSoldOutGraceSkuIds(orgId: string, warehouseId: string | undefined, asOfDate: string): Promise<Set<string>> {
  const asOfDateOnly = new Date(`${asOfDate}T00:00:00.000Z`);
  const graceWindowStart = new Date(`${format(addDays(parseISO(asOfDate), -SOLD_OUT_VISIBLE_DAYS), 'yyyy-MM-dd')}T00:00:00.000Z`);
  const candidates = await prisma.sku.findMany({
    where: {
      warehouse: activeWarehouseOf(orgId),
      ...(warehouseId ? { warehouseId } : {}),
      isHiddenFromDashboard: false,
      soldOutDetectedDate: { not: null, lte: asOfDateOnly, gte: graceWindowStart },
    },
    select: { id: true, soldOutDetectedDate: true },
  });
  const result = new Set<string>();
  for (const c of candidates) {
    if (!c.soldOutDetectedDate) continue;
    const detectedStr = dateOnlyToString(c.soldOutDetectedDate);
    if (asOfDate < soldOutGraceEndDate(detectedStr)) result.add(c.id);
  }
  return result;
}

/**
 * mock과 실데이터는 절대 같은 시계열에 섞이면 안 된다(README 참고). 창고별로 실데이터가
 * 하나라도 있으면 그 창고는 "실데이터 모드"로 보고 mock 스냅샷을 전부 제외하고, 아직 실데이터가
 * 없는 창고(개발/데모 단계)만 mock을 그대로 허용한다.
 */
async function resolveMockFilter(orgId: string, warehouseId?: string, asOfDate?: string): Promise<Prisma.InventorySnapshotWhereInput> {
  const realWarehouses = await prisma.inventorySnapshot.findMany({
    where: {
      status: 'ACTIVE',
      isMock: false,
      warehouse: { organizationId: orgId },
      ...(warehouseId ? { warehouseId } : {}),
      ...(asOfDate ? { snapshotDate: { lte: new Date(`${asOfDate}T00:00:00.000Z`) } } : {}),
    },
    select: { warehouseId: true },
    distinct: ['warehouseId'],
  });
  const realWarehouseIds = realWarehouses.map((w) => w.warehouseId);
  if (realWarehouseIds.length === 0) return {};
  return { OR: [{ isMock: false }, { isMock: true, warehouseId: { notIn: realWarehouseIds } }] };
}

/**
 * SnapshotInbound는 특정 스냅샷 버전이 아니라 (SKU, 날짜)에 독립적으로 붙어있으므로
 * snapshot.status/isMock을 거칠 필요 없이 skuId·날짜로 바로 조회한다.
 */
export async function loadInboundsBySku(skuIds: string[], asOfDate?: string): Promise<Map<string, DatedInbound[]>> {
  if (skuIds.length === 0) return new Map();
  const entries = await prisma.snapshotInbound.findMany({
    where: {
      skuId: { in: skuIds },
      ...(asOfDate ? { snapshotDate: { lte: new Date(`${asOfDate}T00:00:00.000Z`) } } : {}),
    },
    select: { skuId: true, quantity: true, snapshotDate: true },
  });
  const result = new Map<string, DatedInbound[]>();
  for (const entry of entries) {
    const list = result.get(entry.skuId) ?? [];
    list.push({ date: dateOnlyToString(entry.snapshotDate), quantity: entry.quantity });
    result.set(entry.skuId, list);
  }
  return result;
}

// Shared projection avoids transferring unused item IDs, extra JSON and audit fields for every observation.
const observationSelect = {
  skuId: true,
  unitCost: true,
  unitCostProvided: true,
  totalCost: true,
  normalStock: true,
  defectiveStock: true,
  incomingStock: true,
  extra: true,
  snapshot: { select: { snapshotDate: true, warehouseId: true } },
} satisfies Prisma.InventoryItemSelect;

type ObservationItem = Prisma.InventoryItemGetPayload<{ select: typeof observationSelect }>;

type SkuWithSupplier = {
  mergeKey: string | null;
  supplierId: string | null;
  supplier: { id: string; name: string } | null;
  reorderLeadTimeDays: number | null;
  reorderSafetyDays: number | null;
  reorderTargetDays: number | null;
  reorderMinQty: number | null;
  reorderMultiple: number | null;
};

/** 발주 기준 — 품목 예외만 담는다(거래처 값은 서비스에서 거래처 목록으로 합친다). */
function supplierFields(sku: SkuWithSupplier) {
  return {
    mergeKey: sku.mergeKey,
    supplierId: sku.supplier?.id ?? null,
    supplierName: sku.supplier?.name ?? null,
    reorderOverrides: {
      leadTimeDays: sku.reorderLeadTimeDays,
      safetyDays: sku.reorderSafetyDays,
      targetDays: sku.reorderTargetDays,
      minOrderQty: sku.reorderMinQty,
      orderMultiple: sku.reorderMultiple,
    },
  };
}

/** 직접 입력한 실사 줄은 extra.manual = true로 저장된다(count-repository). */
function isManualCount(extra: unknown) {
  return !!extra && typeof extra === 'object' && (extra as { manual?: unknown }).manual === true;
}

/** SKU에 캐시된 지금 값 — 속성 변경 이력이 없을 때(이력 이전 날짜 등) 대신 쓴다. */
function currentAttributes(sku: {
  currentProductName: string;
  currentOption: string | null;
  currentBarcode: string | null;
  currentLocation: string | null;
  currentWarningQty: number;
  currentDangerQty: number;
}): SkuAttributes {
  return {
    productName: sku.currentProductName,
    option: sku.currentOption,
    barcode: sku.currentBarcode,
    location: sku.currentLocation,
    warningQty: sku.currentWarningQty,
    dangerQty: sku.currentDangerQty,
  };
}

/**
 * 스냅샷 행(날짜순)과 입고 기록을 품목 하나의 재고 원장으로 바꾼다. 원가가 비어 있는 행은 직전에 알려진
 * 단가를 이어받아 평가한다(resolveInventoryCost).
 */
function ledgerForItem(skuId: string, items: ObservationItem[], inbounds: DatedInbound[], history: SkuAttributeVersionRow[] | undefined, fallback: SkuAttributes): LedgerEntry[] {
  let latestKnownUnitCost: number | null = null;
  const entries: LedgerEntry[] = items.map((item) => {
    const resolved = resolveInventoryCost(
      {
        unitCost: Number(item.unitCost),
        unitCostProvided: item.unitCostProvided,
        totalCost: item.totalCost === null ? null : Number(item.totalCost),
        normalStock: item.normalStock,
      },
      latestKnownUnitCost,
    );
    latestKnownUnitCost = resolved.latestKnownUnitCost;
    const date = dateOnlyToString(item.snapshot.snapshotDate);
    // 파일의 위험/경고수량은 그 날짜에 효력 있던 값(속성 변경 이력)을 쓴다.
    const attributes = attributesAt(history, date) ?? fallback;
    return {
      date,
      locationId: item.snapshot.warehouseId,
      itemId: skuId,
      // 현재 업로드 규격은 정상재고를 유일한 재고 수량으로 쓴다(가용재고 열이 비어 0으로 저장된 과거 자료 포함).
      source: isManualCount(item.extra) ? 'COUNT' : 'SNAPSHOT',
      quantity: item.normalStock,
      valuation: {
        unitCost: resolved.unitCost,
        totalCost: resolved.totalCost,
        valuationKnown: resolved.valuationKnown,
        defectiveStock: item.defectiveStock,
        incomingStock: item.incomingStock,
        warningQty: attributes.warningQty,
        dangerQty: attributes.dangerQty,
      },
    };
  });
  const locationId = items[0]?.snapshot.warehouseId ?? '';
  for (const inbound of inbounds) entries.push({ date: inbound.date, locationId, itemId: skuId, source: 'INBOUND', quantity: inbound.quantity });
  return entries;
}

/** 기준일의 최신 스냅샷에 존재하는 SKU와 관측 시계열. 현재 isActive는 과거 조회에 적용하지 않는다. */
export async function loadActiveSkusWithSeries(
  orgId: string,
  warehouseId?: string,
  asOfDate?: string,
  holidays: CalendarInput = NO_HOLIDAYS,
): Promise<{ descriptor: SkuDescriptor; observations: StockObservation[] }[]> {
  const mockFilter = await resolveMockFilter(orgId, warehouseId, asOfDate);
  const latestSnapshots = await prisma.inventorySnapshot.findMany({
    where: {
      status: 'ACTIVE',
      warehouse: activeWarehouseOf(orgId),
      ...(warehouseId ? { warehouseId } : {}),
      ...(asOfDate ? { snapshotDate: { lte: new Date(`${asOfDate}T00:00:00.000Z`) } } : {}),
      ...mockFilter,
    },
    select: { id: true, warehouseId: true },
    orderBy: { snapshotDate: 'desc' },
  });
  // snapshotDate desc로 정렬되어 있으므로, 창고별로 "처음 등장하는" 항목만 남겨야 최신 스냅샷이 된다
  // (Map을 새 배열로 바로 만들면 뒤에 오는 과거 스냅샷이 값을 덮어써 가장 오래된 스냅샷이 선택되는 버그가 생긴다).
  const latestSnapshotIdByWarehouse = new Map<string, string>();
  for (const snapshot of latestSnapshots) {
    if (!latestSnapshotIdByWarehouse.has(snapshot.warehouseId)) {
      latestSnapshotIdByWarehouse.set(snapshot.warehouseId, snapshot.id);
    }
  }
  const latestSnapshotIds = [...latestSnapshotIdByWarehouse.values()];
  if (latestSnapshotIds.length === 0) return [];

  const latestItems = await prisma.inventoryItem.findMany({
    where: { snapshotId: { in: latestSnapshotIds } },
    select: { skuId: true, extra: true },
  });
  // 그날(asOfDate) 기준 최신 목록에서의 상태로 판단한다 — 나중에 품절·제외돼도 그 전 날짜로 보면 평소 품목이다.
  const inLatest = new Set(latestItems.map((item) => item.skuId));
  const activeSkuIds = latestItems.filter((item) => stockStatusOf(item.extra) === null).map((item) => item.skuId);
  const zeroSoldOutSkuIds = new Set(latestItems.filter((item) => stockStatusOf(item.extra) === 'soldOut').map((item) => item.skuId));

  // 최신 목록엔 없어도 품절 인식 180일 유예기간 이내인 SKU는 계속 포함한다(휘발 방지).
  // 최신 목록에 있는 품목은 위에서 그 행의 상태로 이미 판단했으므로 제외한다(관리 제외된 재고 0 행 포함).
  const missingSoldOutSkuIds = asOfDate ? await resolveSoldOutGraceSkuIds(orgId, warehouseId, asOfDate) : new Set<string>();
  for (const id of inLatest) missingSoldOutSkuIds.delete(id);
  const soldOutSkuIds = new Set([...missingSoldOutSkuIds, ...zeroSoldOutSkuIds]);
  const combinedSkuIds = [...new Set([...activeSkuIds, ...soldOutSkuIds])];

  const skus = await prisma.sku.findMany({
    where: { id: { in: combinedSkuIds }, isHiddenFromDashboard: false, warehouse: activeWarehouseOf(orgId), ...(warehouseId ? { warehouseId } : {}) },
    include: {
      warehouse: { select: { id: true, code: true, name: true } },
      supplier: { select: { id: true, name: true, leadTimeDays: true, safetyDays: true, targetDays: true, minOrderQty: true, orderMultiple: true } },
    },
  });
  if (skus.length === 0) return [];

  const skuIds = skus.map((s) => s.id);
  const items = await prisma.inventoryItem.findMany({
    where: {
      skuId: { in: skuIds },
      snapshot: {
        status: 'ACTIVE',
        ...(asOfDate ? { snapshotDate: { lte: new Date(`${asOfDate}T00:00:00.000Z`) } } : {}),
        ...mockFilter,
      },
    },
    select: observationSelect,
    orderBy: { snapshot: { snapshotDate: 'asc' } },
  });
  const [inboundsBySku, historyBySku] = await Promise.all([loadInboundsBySku(skuIds, asOfDate), loadSkuAttributeHistory(skuIds, asOfDate)]);

  const itemsBySku = new Map<string, ObservationItem[]>();
  for (const item of items) {
    const list = itemsBySku.get(item.skuId);
    if (list) list.push(item);
    else itemsBySku.set(item.skuId, [item]);
  }
  // asOfDate 시점 기준 가장 최근 관측일에 효력 있던 상품 속성을 쓴다. sku.current*는 asOfDate와 무관하게 항상
  // "지금" 값이라 과거 조회에 미래 변경 사항이 섞여 보이므로 이력이 없을 때만 쓴다.
  const attributesOf = (skuId: string) => {
    const last = itemsBySku.get(skuId)?.at(-1);
    return last ? attributesAt(historyBySku.get(skuId), dateOnlyToString(last.snapshot.snapshotDate)) : null;
  };

  // 재고 0으로 품절된 품목은 그날 기준으로 재고 0이 시작된 날부터 180일 동안만 품절 목록에 보인다.
  const zeroSoldOutSince = new Map<string, string>();
  const expired = new Set<string>();
  for (const id of zeroSoldOutSkuIds) {
    const start = trailingSoldOutStart(itemsBySku.get(id) ?? []);
    if (!start) continue;
    if (asOfDate && asOfDate >= soldOutGraceEndDate(start)) expired.add(id);
    else zeroSoldOutSince.set(id, start);
  }

  return skus
    .filter((sku) => !expired.has(sku.id))
    .map((sku) => {
      const attrs = attributesOf(sku.id);
      return {
        descriptor: {
          skuId: sku.id,
          warehouseId: sku.warehouseId,
          warehouseCode: sku.warehouse.code,
          warehouseName: sku.warehouse.name,
          productCode: sku.productCode,
          productName: attrs?.productName ?? sku.currentProductName,
          option: attrs ? attrs.option : sku.currentOption,
          barcode: attrs ? attrs.barcode : sku.currentBarcode,
          location: attrs ? attrs.location : sku.currentLocation,
          manualDangerQty: sku.manualDangerQty,
          manualWarningQty: sku.manualWarningQty,
          expirationDate: sku.expirationDate ? dateOnlyToString(sku.expirationDate) : null,
          expirationRiskDays: sku.expirationRiskDays,
          isB2B: sku.isB2B,
          specialNote: sku.specialNote,
          firstSeenDate: dateOnlyToString(sku.firstSeenDate),
          isSoldOut: soldOutSkuIds.has(sku.id),
          soldOutDetectedDate: zeroSoldOutSince.get(sku.id) ?? (sku.soldOutDetectedDate ? dateOnlyToString(sku.soldOutDetectedDate) : null),
          eaPerBox: sku.eaPerBox,
          eaPerPallet: sku.eaPerPallet,
          packagingBarcode: sku.packagingBarcode,
          ...supplierFields(sku),
        },
        observations: observationsFromLedger(
          ledgerForItem(sku.id, itemsBySku.get(sku.id) ?? [], inboundsBySku.get(sku.id) ?? [], historyBySku.get(sku.id), currentAttributes(sku)),
          calendarOf(holidays, sku.warehouseId),
        ),
      };
    });
}

/** 차트용 일자별 창고별 합계(재고수량/재고자산). ACTIVE 스냅샷만 집계하며, 숨김 처리된 SKU는 제외한다. */
export async function loadDailyWarehouseTotals(orgId: string, asOfDate?: string): Promise<DailyWarehouseTotal[]> {
  const endDate = asOfDate ? new Date(`${asOfDate}T00:00:00.000Z`) : null;
  // Match resolveInventoryCost without sending every historical item to Node:
  // each explicit cost starts a new carry-forward group; before the first explicit
  // cost, use the first inferable total/quantity only from its observation date onward.
  const totals = await prisma.$queryRaw<
    {
      date: Date;
      warehouseId: string;
      totalAvailableStock: bigint;
      totalInventoryValue: Prisma.Decimal;
    }[]
  >`
    WITH org_warehouses AS (
      SELECT id FROM warehouses WHERE "organizationId" = ${orgId} AND NOT "isArchived" AND "kind" = 'STOCK' AND "segment" = 'DAILY_SYNC'
    ), real_warehouses AS (
      SELECT DISTINCT "warehouseId" FROM inventory_snapshots
      WHERE status = 'ACTIVE' AND NOT "isMock"
        AND (${endDate}::date IS NULL OR "snapshotDate" <= ${endDate}::date)
    ), observations AS (
      SELECT i."skuId", s."warehouseId", s."snapshotDate", i."normalStock",
        i."unitCost", i."unitCostProvided", i."totalCost",
        COUNT(*) FILTER (WHERE i."unitCostProvided") OVER (
          PARTITION BY i."skuId" ORDER BY s."snapshotDate" ROWS UNBOUNDED PRECEDING
        ) AS cost_group
      FROM inventory_items i
      JOIN inventory_snapshots s ON s.id = i."snapshotId"
      JOIN skus k ON k.id = i."skuId"
      JOIN org_warehouses ow ON ow.id = s."warehouseId"
      WHERE s.status = 'ACTIVE' AND NOT k."isHiddenFromDashboard"
        AND (${endDate}::date IS NULL OR s."snapshotDate" <= ${endDate}::date)
        AND (NOT s."isMock" OR NOT EXISTS (
          SELECT 1 FROM real_warehouses r WHERE r."warehouseId" = s."warehouseId"
        ))
    ), costs AS (
      SELECT *,
        MAX("unitCost") FILTER (WHERE "unitCostProvided") OVER (PARTITION BY "skuId", cost_group) AS explicit_cost,
        MIN("snapshotDate") FILTER (WHERE "totalCost" IS NOT NULL AND "normalStock" <> 0)
          OVER (PARTITION BY "skuId") AS inferred_date,
        FIRST_VALUE("totalCost" / NULLIF("normalStock", 0)) OVER (
          PARTITION BY "skuId"
          ORDER BY CASE WHEN "totalCost" IS NOT NULL AND "normalStock" <> 0 THEN 0 ELSE 1 END, "snapshotDate"
        ) AS inferred_cost
      FROM observations
    )
    SELECT "snapshotDate" AS date, "warehouseId", SUM("normalStock") AS "totalAvailableStock",
      SUM(COALESCE("totalCost", "normalStock" * COALESCE(explicit_cost,
        CASE WHEN "snapshotDate" >= inferred_date THEN inferred_cost END, 0))) AS "totalInventoryValue"
    FROM costs GROUP BY "snapshotDate", "warehouseId" ORDER BY "snapshotDate", "warehouseId"
  `;
  return totals.map((total) => ({
    ...total,
    date: dateOnlyToString(total.date),
    totalAvailableStock: Number(total.totalAvailableStock),
    totalInventoryValue: Number(total.totalInventoryValue),
  }));
}

export async function loadSkuWithSeries(
  orgId: string,
  skuId: string,
  asOfDate?: string,
  holidays: CalendarInput = NO_HOLIDAYS,
): Promise<{ descriptor: SkuDescriptor; observations: StockObservation[] } | null> {
  const sku = await prisma.sku.findFirst({
    where: { id: skuId, warehouse: activeWarehouseOf(orgId) },
    include: {
      warehouse: { select: { id: true, code: true, name: true } },
      supplier: { select: { id: true, name: true, leadTimeDays: true, safetyDays: true, targetDays: true, minOrderQty: true, orderMultiple: true } },
    },
  });
  if (!sku || sku.isHiddenFromDashboard) return null;

  const mockFilter = await resolveMockFilter(orgId, sku.warehouseId, asOfDate);
  // Match the list's point-in-time membership, including SKUs now inactive.
  const latestSnapshot = await prisma.inventorySnapshot.findFirst({
    where: { warehouseId: sku.warehouseId, status: 'ACTIVE', ...mockFilter, ...(asOfDate ? { snapshotDate: { lte: new Date(`${asOfDate}T00:00:00.000Z`) } } : {}) },
    orderBy: { snapshotDate: 'desc' },
    select: { id: true },
  });
  const latestRow = latestSnapshot
    ? await prisma.inventoryItem.findUnique({ where: { snapshotId_skuId: { snapshotId: latestSnapshot.id, skuId } }, select: { extra: true } })
    : null;
  const isInLatestSnapshot = !!latestRow;
  const latestStatus = latestRow ? stockStatusOf(latestRow.extra) : null;
  // 재고 0을 '관리 제외'로 올린 품목은 그날부터 보이지 않는다(그 전 날짜로 보면 평소대로 보인다).
  if (latestStatus === 'removed') return null;
  // 최신 목록에는 없어도 품절 인식 180일 유예기간 이내면(휘발 방지) 목록과 동일하게 계속 보여준다.
  let isSoldOut = latestStatus === 'soldOut';
  if (!isInLatestSnapshot) {
    if (!asOfDate || !sku.soldOutDetectedDate) return null;
    const detectedStr = dateOnlyToString(sku.soldOutDetectedDate);
    if (detectedStr > asOfDate || asOfDate >= soldOutGraceEndDate(detectedStr)) return null;
    isSoldOut = true;
  }
  const items = await prisma.inventoryItem.findMany({
    where: {
      skuId,
      snapshot: {
        status: 'ACTIVE',
        ...(asOfDate ? { snapshotDate: { lte: new Date(`${asOfDate}T00:00:00.000Z`) } } : {}),
        ...mockFilter,
      },
    },
    select: observationSelect,
    orderBy: { snapshot: { snapshotDate: 'asc' } },
  });
  // 재고 0으로 품절된 품목: 그날 기준 재고 0이 시작된 날부터 180일까지만 보여준다(목록과 같은 규칙).
  const zeroSoldOutSince = latestStatus === 'soldOut' ? trailingSoldOutStart(items) : null;
  if (zeroSoldOutSince && asOfDate && asOfDate >= soldOutGraceEndDate(zeroSoldOutSince)) return null;
  const [inboundsBySku, historyBySku] = await Promise.all([loadInboundsBySku([skuId], asOfDate), loadSkuAttributeHistory([skuId], asOfDate)]);
  const history = historyBySku.get(skuId);

  const observations = observationsFromLedger(ledgerForItem(skuId, items, inboundsBySku.get(skuId) ?? [], history, currentAttributes(sku)), calendarOf(holidays, sku.warehouseId));

  // asOfDate 시점 기준 가장 최근 관측일에 효력 있던 상품 속성을 쓴다(과거 조회에 이후 변경분이 섞이지 않도록).
  const latestItem = items.at(-1);
  const latestAttrs = latestItem ? attributesAt(history, dateOnlyToString(latestItem.snapshot.snapshotDate)) : null;

  return {
    descriptor: {
      skuId: sku.id,
      warehouseId: sku.warehouseId,
      warehouseCode: sku.warehouse.code,
      warehouseName: sku.warehouse.name,
      productCode: sku.productCode,
      productName: latestAttrs?.productName ?? sku.currentProductName,
      option: latestAttrs ? latestAttrs.option : sku.currentOption,
      barcode: latestAttrs ? latestAttrs.barcode : sku.currentBarcode,
      location: latestAttrs ? latestAttrs.location : sku.currentLocation,
      manualDangerQty: sku.manualDangerQty,
      manualWarningQty: sku.manualWarningQty,
      expirationDate: sku.expirationDate ? dateOnlyToString(sku.expirationDate) : null,
      expirationRiskDays: sku.expirationRiskDays,
      isB2B: sku.isB2B,
      specialNote: sku.specialNote,
      firstSeenDate: dateOnlyToString(sku.firstSeenDate),
      isSoldOut,
      soldOutDetectedDate: zeroSoldOutSince ?? (sku.soldOutDetectedDate ? dateOnlyToString(sku.soldOutDetectedDate) : null),
      eaPerBox: sku.eaPerBox,
      eaPerPallet: sku.eaPerPallet,
      packagingBarcode: sku.packagingBarcode,
      ...supplierFields(sku),
    },
    observations,
  };
}

export interface SkuVisibilityRow {
  skuId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  isActive: boolean;
  isHiddenFromDashboard: boolean;
}

/**
 * 설정 화면의 "SKU 숨기기" 관리용 — 최신 업로드에 남아 있는 SKU와, 목록에서 빠졌더라도(품절로 빠진 SKU 등) 숨겨 둔 SKU를 나열한다.
 * 숨긴 SKU는 상세 화면에서도 숨길 수 있으므로 최신 업로드에 없어도 여기서 다시 표시할 수 있어야 한다.
 */
export async function listAllSkusForVisibilityAdmin(orgId: string): Promise<SkuVisibilityRow[]> {
  const skus = await prisma.sku.findMany({
    where: { OR: [{ isActive: true }, { isHiddenFromDashboard: true }], warehouse: activeWarehouseOf(orgId) },
    include: { warehouse: { select: { code: true, name: true } } },
    orderBy: [{ warehouse: { sortOrder: 'asc' } }, { productCode: 'asc' }],
  });
  return skus.map((sku) => ({
    skuId: sku.id,
    warehouseId: sku.warehouseId,
    warehouseCode: sku.warehouse.code,
    warehouseName: sku.warehouse.name,
    productCode: sku.productCode,
    productName: sku.currentProductName,
    isActive: sku.isActive,
    isHiddenFromDashboard: sku.isHiddenFromDashboard,
  }));
}

export class SkuNotFoundError extends Error {}

/** 요청의 skuId가 이 조직 소속인지 확인한다. 조직 밖의 SKU는 존재하지 않는 것으로 취급한다. */
export async function isSkuInOrg(orgId: string, skuId: string): Promise<boolean> {
  const sku = await prisma.sku.findFirst({ where: { id: skuId, warehouse: { organizationId: orgId } }, select: { id: true } });
  return sku !== null;
}

async function assertSkuInOrg(orgId: string, skuId: string) {
  if (!(await isSkuInOrg(orgId, skuId))) throw new SkuNotFoundError('SKU를 찾을 수 없습니다.');
}

export async function setSkuHiddenFromDashboard(orgId: string, skuId: string, hidden: boolean) {
  await assertSkuInOrg(orgId, skuId);
  return prisma.sku.update({ where: { id: skuId }, data: { isHiddenFromDashboard: hidden } });
}

export async function setSkuB2B(orgId: string, skuId: string, isB2B: boolean) {
  await assertSkuInOrg(orgId, skuId);
  return prisma.sku.update({ where: { id: skuId }, data: { isB2B } });
}

export async function setSkuSpecialNote(orgId: string, skuId: string, specialNote: string) {
  await assertSkuInOrg(orgId, skuId);
  return prisma.sku.update({ where: { id: skuId }, data: { specialNote } });
}

/** 위험/경고수량 직접 설정. 필드별로 null을 넘기면 그 필드만 자동계산으로 되돌린다. */
export async function setSkuManualThresholds(orgId: string, skuId: string, input: { dangerQty: number | null; warningQty: number | null }) {
  await assertSkuInOrg(orgId, skuId);
  return prisma.sku.update({ where: { id: skuId }, data: { manualDangerQty: input.dangerQty, manualWarningQty: input.warningQty } });
}

export interface SkuSearchResult {
  skuId: string;
  productCode: string;
  productName: string;
}

/**
 * 입고 특이사항 등록용 SKU 드롭다운 검색 — 자유 텍스트 매칭 대신 실제 SKU를 골라 선택하게 한다.
 *
 * DB의 `contains`는 공백을 그대로 비교하는데, 실제 상품명은 월별 업로드마다 "750g 레몬" /
 * "750g  레몬"처럼 공백 개수가 들쭉날쭉한 경우가 흔하다. 검색어와 상품명 양쪽에서 공백을
 * 전부 제거하고 비교해, 검색창에 입력한 공백 형태가 DB에 저장된 형태와 정확히 일치하지
 * 않아도(예: "레몬 750g" vs "레몬750g") 같은 상품으로 찾아지도록 한다. 창고 하나의 SKU
 * 수는 수백 건 수준이라 전체를 불러와 메모리에서 비교해도 비용이 크지 않다.
 */
export async function searchSkusInWarehouse(warehouseId: string, query: string, limit = 20): Promise<SkuSearchResult[]> {
  const q = query.trim();
  if (q === '') return [];
  const normalizedQuery = q.replace(/\s+/g, '').toLowerCase();

  const skus = await prisma.sku.findMany({
    // isActive(가장 최근 스냅샷에 존재하는지)로 거르지 않는다 — 입고 처리는 최근 업로드에서
    // 빠진("사라진") SKU에 재고가 들어올 때 쓰는 경우가 많아, 여기서 걸러버리면 정작
    // 입고를 기록해야 할 SKU를 검색으로 찾을 수 없게 된다.
    where: { warehouseId },
    select: { id: true, productCode: true, currentProductName: true },
    orderBy: { productCode: 'asc' },
  });

  const matches = skus.filter((sku) => {
    const normalizedCode = sku.productCode.replace(/\s+/g, '').toLowerCase();
    const normalizedName = sku.currentProductName.replace(/\s+/g, '').toLowerCase();
    return normalizedCode.includes(normalizedQuery) || normalizedName.includes(normalizedQuery);
  });

  return matches.slice(0, limit).map((sku) => ({ skuId: sku.id, productCode: sku.productCode, productName: sku.currentProductName }));
}
