import { calculateInventoryValueBreakdown, calculatePeriodComparison } from '@/domain/inventory/calculations';
import { analyzeOperationalSku as analyzeSku } from '@/domain/inventory/operational-analysis';
import { loadWarehouseCalendars } from '@/server/repositories/calendar-repository';
import { listExpirationLotsForSku } from '@/server/repositories/expiration-repository';
import type { RiskThresholdSettings } from '@/domain/inventory/types';

import { loadActiveSkusWithSeries, loadSkuWithSeries } from '@/server/repositories/inventory-repository';
import { getSettings } from '@/server/repositories/settings-repository';

import type { InventoryRow } from '@/domain/inventory/read-model';

export async function getInventoryRows(options: {
  orgId: string;
  warehouseId?: string;
  asOfDate: string;
  compareFromDate?: string;
  settings?: RiskThresholdSettings;
}): Promise<InventoryRow[]> {
  const settings = options.settings ?? (await getSettings(options.orgId));
  const { calendarFor } = await loadWarehouseCalendars(options.orgId);
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
    rows.push({ descriptor, analysis, valueBreakdown, periodComparison });
  }
  return rows;
}

export async function getSkuDetail(orgId: string, skuId: string, asOfDate: string, settings?: RiskThresholdSettings) {
  const resolvedSettings = settings ?? (await getSettings(orgId));
  const { calendarFor } = await loadWarehouseCalendars(orgId);
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
  return { descriptor: result.descriptor, analysis, valueBreakdown, observations: result.observations, expirationLots };
}
