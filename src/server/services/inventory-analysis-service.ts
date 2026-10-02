import { calculateInventoryValueBreakdown, calculatePeriodComparison } from '@/domain/inventory/calculations';
import { analyzeOperationalSku as analyzeSku } from '@/domain/inventory/operational-analysis';
import { loadWarehouseCalendars } from '@/server/repositories/calendar-repository';
import { listExpirationLotsForSku } from '@/server/repositories/expiration-repository';
import type { RiskThresholdSettings } from '@/domain/inventory/types';

import { loadActiveSkusWithSeries, loadSkuWithSeries } from '@/server/repositories/inventory-repository';
import { getSettings } from '@/server/repositories/settings-repository';
import { getReorderDefaults, loadSupplierPolicies } from '@/server/repositories/reorder-repository';
import { resolvePolicy, suggestReorder, turnover, type PolicyKey, type PolicyLayer } from '@/domain/reorder/reorder';
import type { ClosedDays } from '@/domain/inventory/shipping-calendar';
import type { SkuAnalysis, StockObservation } from '@/domain/inventory/types';
import type { SkuDescriptor } from '@/domain/inventory/read-model';

import type { InventoryRow } from '@/domain/inventory/read-model';
import { basisRate } from '@/domain/inventory/merge';
import { nowcastStock } from '@/domain/inventory/nowcast';
import { dataRevision, lastWriteAt } from '@/lib/data-revision';


/** 최근 30일 회전율 — 관측이 5회 미만이면 믿기 어려워 계산하지 않는다. */
function turnover30(observations: StockObservation[], a: SkuAnalysis): InventoryRow['turnover30'] {
  const from = new Date(Date.parse(`${a.latest.date}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  const recent = observations.filter((o) => o.date > from && o.date <= a.latest.date);
  if (recent.length < 5) return null;
  const averageStock = recent.reduce((sum, o) => sum + Math.max(0, o.normalStock), 0) / recent.length;
  return { ratio: turnover(a.window30.totalDepletion, averageStock), depletion: a.window30.totalDepletion, averageStock };
}

type SkuInput = { descriptor: SkuDescriptor; observations: StockObservation[] };

function analyzeFor({ descriptor, observations }: SkuInput, asOfDate: string, settings: RiskThresholdSettings, calendar: ClosedDays) {
  return analyzeSku(
    observations,
    asOfDate,
    settings,
    { dangerQty: descriptor.manualDangerQty, warningQty: descriptor.manualWarningQty },
    { expirationDate: descriptor.expirationDate, expirationRiskDays: descriptor.expirationRiskDays },
    { holidays: calendar, isB2B: descriptor.isB2B, isMissing: descriptor.isSoldOut },
  );
}

/** 기준일까지 출고일이 지났는데 재고 자료가 없으면 직전 자료로 오늘 재고를 추정한다. KPI·위험 판정은 그대로 실제 관측값을 쓴다. */
function nowcastFor(input: SkuInput, analysis: SkuAnalysis, asOfDate: string, calendar: ClosedDays) {
  if (!analysis.operating || analysis.operating.staleShippingDays <= 0) return null;
  return nowcastStock({ observations: input.observations, asOfDate, holidays: calendar, isB2B: input.descriptor.isB2B, isSoldOut: input.descriptor.isSoldOut });
}

interface ReorderContext {
  defaults: { [K in PolicyKey]: number };
  suppliers: Map<string, PolicyLayer>;
  asOfDate: string;
}

async function loadReorderContext(orgId: string, asOfDate: string): Promise<ReorderContext> {
  const [defaults, suppliers] = await Promise.all([getReorderDefaults(orgId), loadSupplierPolicies(orgId)]);
  return { defaults, suppliers, asOfDate };
}

function reorderFor(ctx: ReorderContext, descriptor: SkuDescriptor, analysis: SkuAnalysis, calendar: ClosedDays) {
  if (descriptor.isB2B || descriptor.isSoldOut) return null;
  const policy = resolvePolicy(ctx.defaults, descriptor.supplierId ? ctx.suppliers.get(descriptor.supplierId) : null, descriptor.reorderOverrides);
  return suggestReorder({ stock: analysis.latest.normalStock, rate: basisRate(analysis), observedDate: analysis.latest.date, asOfDate: ctx.asOfDate, policy, calendar });
}

/**
 * 대시보드를 열 때마다 품목 수백 개를 처음부터 다시 분석하지 않도록, 같은 조건의 결과를 DB 쓰기가 없는 동안 재사용한다.
 * 업로드·설정 변경 등 어떤 쓰기든 일어나면 리비전이 바뀌어 다음 요청에서 새로 계산한다. 쓰기 직후 몇 초는
 * 트랜잭션이 아직 커밋되지 않았을 수 있어 결과를 저장하지 않는다. 서버 프로세스 하나의 메모리 캐시다.
 */
const ROWS_CACHE_LIMIT = 6;
const WRITE_SETTLE_MS = 5_000;
/** 앱을 거치지 않은 DB 변경(직접 SQL 등)도 오래 남지 않도록 10분이 지나면 새로 계산한다. */
const ROWS_CACHE_TTL_MS = 10 * 60_000;
const rowsCache = new Map<string, { revision: number; at: number; rows: InventoryRow[] }>();

export async function getInventoryRows(options: {
  orgId: string;
  warehouseId?: string;
  asOfDate: string;
  compareFromDate?: string;
  settings?: RiskThresholdSettings;
}): Promise<InventoryRow[]> {
  const revision = dataRevision();
  const startedAt = Date.now();
  const settings = options.settings ?? (await getSettings(options.orgId));
  const key = JSON.stringify([options.orgId, options.warehouseId ?? null, options.asOfDate, options.compareFromDate ?? null, settings]);
  const cached = rowsCache.get(key);
  if (cached && cached.revision === revision && startedAt - cached.at < ROWS_CACHE_TTL_MS) {
    // 최근에 쓴 항목을 맨 뒤로(가장 오래 안 쓴 것부터 버린다).
    rowsCache.delete(key);
    rowsCache.set(key, cached);
    return cached.rows;
  }
  const rows = await computeInventoryRows(options, settings);
  if (dataRevision() === revision && startedAt - lastWriteAt() > WRITE_SETTLE_MS) {
    rowsCache.delete(key);
    rowsCache.set(key, { revision, at: startedAt, rows });
    if (rowsCache.size > ROWS_CACHE_LIMIT) rowsCache.delete(rowsCache.keys().next().value!);
  }
  return rows;
}

async function computeInventoryRows(
  options: { orgId: string; warehouseId?: string; asOfDate: string; compareFromDate?: string },
  settings: RiskThresholdSettings,
): Promise<InventoryRow[]> {
  const [{ calendarFor }, reorderCtx] = await Promise.all([loadWarehouseCalendars(options.orgId), loadReorderContext(options.orgId, options.asOfDate)]);
  const skusWithSeries = await loadActiveSkusWithSeries(options.orgId, options.warehouseId, options.asOfDate, calendarFor);

  const rows: InventoryRow[] = [];
  for (const input of skusWithSeries) {
    const { descriptor, observations } = input;
    const calendar = calendarFor(descriptor.warehouseId);
    const analysis = analyzeFor(input, options.asOfDate, settings, calendar);
    if (!analysis) continue; // asOfDate 이전 관측치가 없는 SKU(예: 미래 등록)는 제외
    const valueBreakdown = calculateInventoryValueBreakdown(analysis.latest);
    const periodComparison = options.compareFromDate ? calculatePeriodComparison(observations, options.compareFromDate, options.asOfDate) : null;
    rows.push({
      descriptor,
      analysis,
      valueBreakdown,
      periodComparison,
      reorder: reorderFor(reorderCtx, descriptor, analysis, calendar),
      turnover30: turnover30(observations, analysis),
      nowcast: nowcastFor(input, analysis, options.asOfDate, calendar),
    });
  }
  return rows;
}

export async function getSkuDetail(orgId: string, skuId: string, asOfDate: string, settings?: RiskThresholdSettings) {
  const resolvedSettings = settings ?? (await getSettings(orgId));
  const [{ calendarFor }, reorderCtx] = await Promise.all([loadWarehouseCalendars(orgId), loadReorderContext(orgId, asOfDate)]);
  const result = await loadSkuWithSeries(orgId, skuId, asOfDate, calendarFor);
  if (!result) return null;
  const calendar = calendarFor(result.descriptor.warehouseId);
  const analysis = analyzeFor(result, asOfDate, resolvedSettings, calendar);
  if (!analysis) return null;
  const valueBreakdown = calculateInventoryValueBreakdown(analysis.latest);
  const expirationLots = await listExpirationLotsForSku(skuId);
  return {
    descriptor: result.descriptor,
    analysis,
    valueBreakdown,
    observations: result.observations,
    expirationLots,
    reorder: reorderFor(reorderCtx, result.descriptor, analysis, calendar),
    turnover30: turnover30(result.observations, analysis),
    nowcast: nowcastFor(result, analysis, asOfDate, calendar),
  };
}
