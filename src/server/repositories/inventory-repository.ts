import { addMonths, format, parseISO } from 'date-fns';
import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';
import type { StockObservation } from '@/domain/inventory/types';
import { resolveInventoryCost } from '@/domain/inventory/costs';
import type { Prisma } from '@prisma/client';
import type { SkuDescriptor, DailyWarehouseTotal } from '@/domain/inventory/read-model';
import { attachIntervalInbounds, type DatedInbound } from '@/domain/inventory/inbounds';
import { NO_HOLIDAYS } from '@/domain/inventory/shipping-calendar';

/** 조직의 사용 중인(보관되지 않은) 창고에 속한 데이터만 보도록 하는 공통 조건. */
function activeWarehouseOf(orgId: string) {
  return { organizationId: orgId, isArchived: false };
}

/** 품절 인식일로부터 정확히 1개월 뒤(유예기간 종료일, 이 날짜부터는 더 이상 노출하지 않음). */
function soldOutGraceEndDate(soldOutDetectedDateStr: string): string {
  return format(addMonths(parseISO(soldOutDetectedDateStr), 1), 'yyyy-MM-dd');
}

/**
 * 최신 업로드 목록에서 빠져 품절로 인식됐지만(soldOutDetectedDate), asOfDate 기준 아직 1개월
 * 유예기간 이내인 SKU의 id를 돌려준다. 마지막 관측 데이터가 그대로 노출되도록(휘발 방지) 하는 게
 * 목적이라 관측치 자체는 건드리지 않고, 어떤 SKU를 결과 집합에 추가로 포함할지만 결정한다.
 */
async function resolveSoldOutGraceSkuIds(orgId: string, warehouseId: string | undefined, asOfDate: string): Promise<Set<string>> {
  const asOfDateOnly = new Date(`${asOfDate}T00:00:00.000Z`);
  const graceWindowStart = new Date(`${format(addMonths(parseISO(asOfDate), -1), 'yyyy-MM-dd')}T00:00:00.000Z`);
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
    where: { status: 'ACTIVE', isMock: false, warehouse: { organizationId: orgId }, ...(warehouseId ? { warehouseId } : {}),
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
  skuId: true, productName: true, option: true, barcode: true, location: true,
  unitCost: true, unitCostProvided: true, totalCost: true, normalStock: true,
  defectiveStock: true, incomingStock: true, warningQty: true, dangerQty: true,
  snapshot: { select: { snapshotDate: true } },
} satisfies Prisma.InventoryItemSelect;

/** 기준일의 최신 스냅샷에 존재하는 SKU와 관측 시계열. 현재 isActive는 과거 조회에 적용하지 않는다. */
export async function loadActiveSkusWithSeries(
  orgId: string,
  warehouseId?: string,
  asOfDate?: string,
  holidays: ReadonlySet<string> = NO_HOLIDAYS,
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
    select: { skuId: true },
  });
  const activeSkuIds = [...new Set(latestItems.map((item) => item.skuId))];

  // 최신 목록엔 없어도 품절 인식 1개월 유예기간 이내인 SKU는 계속 포함한다(휘발 방지).
  const soldOutSkuIds = asOfDate ? await resolveSoldOutGraceSkuIds(orgId, warehouseId, asOfDate) : new Set<string>();
  const combinedSkuIds = [...new Set([...activeSkuIds, ...soldOutSkuIds])];

  const skus = await prisma.sku.findMany({
    where: { id: { in: combinedSkuIds }, isHiddenFromDashboard: false, warehouse: activeWarehouseOf(orgId), ...(warehouseId ? { warehouseId } : {}) },
    include: { warehouse: { select: { id: true, code: true, name: true } } },
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
  const inboundsBySku = await loadInboundsBySku(skuIds, asOfDate);

  const observationsBySku = new Map<string, StockObservation[]>();
  const latestKnownUnitCostBySku = new Map<string, number>();
  // items가 snapshotDate asc로 정렬되어 있으므로, 마지막에 덮어써지는 값이 asOfDate 시점 기준
  // "가장 최근" 관측치의 상품 속성이 된다. sku.current*는 asOfDate와 무관하게 항상 "지금" 값이라
  // 과거 조회에 미래 변경 사항이 섞여 보이므로 쓰지 않는다.
  const latestAttrsBySku = new Map<string, { productName: string; option: string | null; barcode: string | null; location: string | null }>();
  for (const item of items) {
    const resolvedCost = resolveInventoryCost(
      {
        unitCost: Number(item.unitCost),
        unitCostProvided: item.unitCostProvided,
        totalCost: item.totalCost === null ? null : Number(item.totalCost),
        normalStock: item.normalStock,
      },
      latestKnownUnitCostBySku.get(item.skuId) ?? null,
    );
    if (resolvedCost.latestKnownUnitCost !== null) {
      latestKnownUnitCostBySku.set(item.skuId, resolvedCost.latestKnownUnitCost);
    }
    const list = observationsBySku.get(item.skuId) ?? [];
    list.push({
      date: dateOnlyToString(item.snapshot.snapshotDate),
      // 현재 업로드 규격은 정상재고를 유일한 재고 수량으로 사용한다. 과거 스냅샷도
      // 별도 가용재고 열이 비어 0으로 저장됐을 수 있으므로 정상재고로 분석한다.
      availableStock: item.normalStock,
      normalStock: item.normalStock,
      defectiveStock: item.defectiveStock,
      incomingStock: item.incomingStock,
      unitCost: resolvedCost.unitCost,
      totalCost: resolvedCost.totalCost,
      valuationKnown: resolvedCost.valuationKnown,
      warningQty: item.warningQty,
      dangerQty: item.dangerQty,
    });
    observationsBySku.set(item.skuId, list);
    latestAttrsBySku.set(item.skuId, { productName: item.productName, option: item.option, barcode: item.barcode, location: item.location });
  }

  return skus.map((sku) => {
    const attrs = latestAttrsBySku.get(sku.id);
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
        firstSeenDate: dateOnlyToString(sku.firstSeenDate),
        isSoldOut: soldOutSkuIds.has(sku.id),
        soldOutDetectedDate: sku.soldOutDetectedDate ? dateOnlyToString(sku.soldOutDetectedDate) : null,
        eaPerBox: sku.eaPerBox,
        eaPerPallet: sku.eaPerPallet,
        packagingBarcode: sku.packagingBarcode,
      },
      observations: attachIntervalInbounds(observationsBySku.get(sku.id) ?? [], inboundsBySku.get(sku.id) ?? [], holidays),
    };
  });
}

/** 차트용 일자별 창고별 합계(재고수량/재고자산). ACTIVE 스냅샷만 집계하며, 숨김 처리된 SKU는 제외한다. */
export async function loadDailyWarehouseTotals(orgId: string, asOfDate?: string): Promise<DailyWarehouseTotal[]> {
  const endDate = asOfDate ? new Date(`${asOfDate}T00:00:00.000Z`) : null;
  // Match resolveInventoryCost without sending every historical item to Node:
  // each explicit cost starts a new carry-forward group; before the first explicit
  // cost, use the first inferable total/quantity only from its observation date onward.
  const totals = await prisma.$queryRaw<{
    date: Date; warehouseId: string; totalAvailableStock: bigint; totalInventoryValue: Prisma.Decimal;
  }[]>`
    WITH org_warehouses AS (
      SELECT id FROM warehouses WHERE "organizationId" = ${orgId} AND NOT "isArchived"
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
  return totals.map(total => ({ ...total, date: dateOnlyToString(total.date),
    totalAvailableStock: Number(total.totalAvailableStock), totalInventoryValue: Number(total.totalInventoryValue),
  }));
}

export async function loadSkuWithSeries(
  orgId: string,
  skuId: string,
  asOfDate?: string,
  holidays: ReadonlySet<string> = NO_HOLIDAYS,
): Promise<{ descriptor: SkuDescriptor; observations: StockObservation[] } | null> {
  const sku = await prisma.sku.findFirst({
    where: { id: skuId, warehouse: activeWarehouseOf(orgId) },
    include: { warehouse: { select: { id: true, code: true, name: true } } },
  });
  if (!sku || sku.isHiddenFromDashboard) return null;

  const mockFilter = await resolveMockFilter(orgId, sku.warehouseId, asOfDate);
  // Match the list's point-in-time membership, including SKUs now inactive.
  const latestSnapshot = await prisma.inventorySnapshot.findFirst({
    where: { warehouseId: sku.warehouseId, status: 'ACTIVE', ...mockFilter,
      ...(asOfDate ? { snapshotDate: { lte: new Date(`${asOfDate}T00:00:00.000Z`) } } : {}),
    }, orderBy: { snapshotDate: 'desc' }, select: { id: true },
  });
  const isInLatestSnapshot = !!latestSnapshot && !!(await prisma.inventoryItem.findUnique({
    where: { snapshotId_skuId: { snapshotId: latestSnapshot.id, skuId } }, select: { id: true },
  }));
  // 최신 목록에는 없어도 품절 인식 1개월 유예기간 이내면(휘발 방지) 목록과 동일하게 계속 보여준다.
  let isSoldOut = false;
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
  const inboundsBySku = await loadInboundsBySku([skuId], asOfDate);

  let latestKnownUnitCost: number | null = null;
  const observations: StockObservation[] = items.map((item) => {
    const resolvedCost = resolveInventoryCost(
      {
        unitCost: Number(item.unitCost),
        unitCostProvided: item.unitCostProvided,
        totalCost: item.totalCost === null ? null : Number(item.totalCost),
        normalStock: item.normalStock,
      },
      latestKnownUnitCost,
    );
    latestKnownUnitCost = resolvedCost.latestKnownUnitCost;
    return {
      date: dateOnlyToString(item.snapshot.snapshotDate),
      availableStock: item.normalStock,
      normalStock: item.normalStock,
      defectiveStock: item.defectiveStock,
      incomingStock: item.incomingStock,
      unitCost: resolvedCost.unitCost,
      totalCost: resolvedCost.totalCost,
      valuationKnown: resolvedCost.valuationKnown,
      warningQty: item.warningQty,
      dangerQty: item.dangerQty,
    };
  });

  // asOfDate 시점 기준 가장 최근 관측치의 상품 속성을 쓴다(과거 조회에 이후 변경분이 섞이지 않도록).
  const latestItem = items.at(-1);

  return {
    descriptor: {
      skuId: sku.id,
      warehouseId: sku.warehouseId,
      warehouseCode: sku.warehouse.code,
      warehouseName: sku.warehouse.name,
      productCode: sku.productCode,
      productName: latestItem?.productName ?? sku.currentProductName,
      option: latestItem ? latestItem.option : sku.currentOption,
      barcode: latestItem ? latestItem.barcode : sku.currentBarcode,
      location: latestItem ? latestItem.location : sku.currentLocation,
      manualDangerQty: sku.manualDangerQty,
      manualWarningQty: sku.manualWarningQty,
      expirationDate: sku.expirationDate ? dateOnlyToString(sku.expirationDate) : null,
      expirationRiskDays: sku.expirationRiskDays,
      isB2B: sku.isB2B,
      firstSeenDate: dateOnlyToString(sku.firstSeenDate),
      isSoldOut,
      soldOutDetectedDate: sku.soldOutDetectedDate ? dateOnlyToString(sku.soldOutDetectedDate) : null,
      eaPerBox: sku.eaPerBox,
      eaPerPallet: sku.eaPerPallet,
      packagingBarcode: sku.packagingBarcode,
    },
    observations: attachIntervalInbounds(observations, inboundsBySku.get(skuId) ?? [], holidays),
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

/** 설정 화면의 "SKU 숨기기" 관리용 — 최신 업로드에 남아 있는 SKU만 나열한다. */
export async function listAllSkusForVisibilityAdmin(orgId: string): Promise<SkuVisibilityRow[]> {
  const skus = await prisma.sku.findMany({
    where: { isActive: true, warehouse: activeWarehouseOf(orgId) },
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
