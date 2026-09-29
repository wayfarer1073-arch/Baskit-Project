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

/** 예측에 실제로 쓴 소진 속도(추정할 수 없는 사유가 있으면 null). */
function basisRate(a: SkuAnalysis): number | null {
  const op = a.operating;
  if (!op || op.reason !== null || !op.basisWindowDays) return null;
  const w = op.basisWindowDays === 7 ? a.window7 : op.basisWindowDays === 14 ? a.window14 : a.window30;
  return w.averageDailyDepletion;
}

/** 최근 30일 회전율 — 관측이 5회 미만이면 믿기 어려워 계산하지 않는다. */
function turnover30(observations: StockObservation[], a: SkuAnalysis): InventoryRow['turnover30'] {
  const from = new Date(Date.parse(`${a.latest.date}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  const recent = observations.filter((o) => o.date > from && o.date <= a.latest.date);
  if (recent.length < 5) return null;
  const averageStock = recent.reduce((sum, o) => sum + Math.max(0, o.normalStock), 0) / recent.length;
  return { ratio: turnover(a.window30.totalDepletion, averageStock), depletion: a.window30.totalDepletion, averageStock };
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

export async function getInventoryRows(options: {
  orgId: string;
  warehouseId?: string;
  asOfDate: string;
  compareFromDate?: string;
  settings?: RiskThresholdSettings;
}): Promise<InventoryRow[]> {
  const settings = options.settings ?? (await getSettings(options.orgId));
  const [{ calendarFor }, reorderCtx] = await Promise.all([loadWarehouseCalendars(options.orgId), loadReorderContext(options.orgId, options.asOfDate)]);
  const skusWithSeries = await loadActiveSkusWithSeries(options.orgId, options.warehouseId, options.asOfDate, calendarFor);

  const rows: InventoryRow[] = [];
  for (const { descriptor, observations } of skusWithSeries) {
    const analysis = analyzeSku(
      observations,
      options.asOfDate,
      settings,
      { dangerQty: descriptor.manualDangerQty, warningQty: descriptor.manualWarningQty },
      { expirationDate: descriptor.expirationDate, expirationRiskDays: descriptor.expirationRiskDays },
      { holidays: calendarFor(descriptor.warehouseId), isB2B: descriptor.isB2B, isMissing: descriptor.isSoldOut },
    );
    if (!analysis) continue; // asOfDate 이전 관측치가 없는 SKU(예: 미래 등록)는 제외
    const valueBreakdown = calculateInventoryValueBreakdown(analysis.latest);
    const periodComparison = options.compareFromDate ? calculatePeriodComparison(observations, options.compareFromDate, options.asOfDate) : null;
    rows.push({
      descriptor,
      analysis,
      valueBreakdown,
      periodComparison,
      reorder: reorderFor(reorderCtx, descriptor, analysis, calendarFor(descriptor.warehouseId)),
      turnover30: turnover30(observations, analysis),
    });
  }
  return rows;
}

export async function getSkuDetail(orgId: string, skuId: string, asOfDate: string, settings?: RiskThresholdSettings) {
  const resolvedSettings = settings ?? (await getSettings(orgId));
  const [{ calendarFor }, reorderCtx] = await Promise.all([loadWarehouseCalendars(orgId), loadReorderContext(orgId, asOfDate)]);
  const result = await loadSkuWithSeries(orgId, skuId, asOfDate, calendarFor);
  if (!result) return null;
  const analysis = analyzeSku(
    result.observations,
    asOfDate,
    resolvedSettings,
    { dangerQty: result.descriptor.manualDangerQty, warningQty: result.descriptor.manualWarningQty },
    { expirationDate: result.descriptor.expirationDate, expirationRiskDays: result.descriptor.expirationRiskDays },
    { holidays: calendarFor(result.descriptor.warehouseId), isB2B: result.descriptor.isB2B, isMissing: result.descriptor.isSoldOut },
  );
  if (!analysis) return null;
  const valueBreakdown = calculateInventoryValueBreakdown(analysis.latest);
  const expirationLots = await listExpirationLotsForSku(skuId);
  return {
    descriptor: result.descriptor,
    analysis,
    valueBreakdown,
    observations: result.observations,
    expirationLots,
    reorder: reorderFor(reorderCtx, result.descriptor, analysis, calendarFor(result.descriptor.warehouseId)),
    turnover30: turnover30(result.observations, analysis),
  };
}
