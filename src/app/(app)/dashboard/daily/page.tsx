import { listWarehouses } from '@/server/repositories/warehouse-repository';
import { getSettings } from '@/server/repositories/settings-repository';
import { getInventoryRows } from '@/server/services/inventory-analysis-service';
import { loadDailyWarehouseTotals } from '@/server/repositories/inventory-repository';
import { getLatestActiveSnapshot } from '@/server/repositories/snapshot-repository';
import { listHolidayDateStrings } from '@/server/repositories/holiday-repository';
import { listFavoriteSkuIds } from '@/server/repositories/favorite-repository';
import { listUpcomingSkuEvents } from '@/server/repositories/event-repository';
import { todayKstDateString, dateOnlyToString } from '@/lib/date';
import { parseDashboardRange } from '@/lib/dashboard-range';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import { requireTenant } from '@/server/tenant';
import { requireEnabledSegment } from '@/server/segments';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const today = todayKstDateString();
  const { asOfDate, fromDate } = parseDashboardRange(params, today);
  const tenant = await requireTenant();
  await requireEnabledSegment(tenant.orgId, 'DAILY_SYNC');
  const settings = await getSettings(tenant.orgId);
  const [warehouses, rows, dailyTotals, holidays, favoriteSkuIds] = await Promise.all([
    listWarehouses(tenant.orgId, 'DAILY_SYNC'),
    getInventoryRows({ orgId: tenant.orgId, asOfDate, compareFromDate: fromDate ?? undefined, settings }),
    loadDailyWarehouseTotals(tenant.orgId, asOfDate),
    listHolidayDateStrings(tenant.orgId),
    listFavoriteSkuIds(tenant.userId),
  ]);
  const isAdmin = tenant.isAdmin;
  const specialSchedules = await listUpcomingSkuEvents(
    tenant.orgId,
    rows.filter((r) => r.descriptor.isB2B).map((r) => r.descriptor.skuId),
    asOfDate,
  );

  const latestUploads = await Promise.all(
    warehouses.map(async (w) => {
      const latest = await getLatestActiveSnapshot(w.id);
      return {
        warehouseId: w.id,
        snapshotDate: latest ? dateOnlyToString(latest.snapshotDate) : null,
        uploadedAt: latest ? latest.uploadedAt.toISOString() : null,
      };
    }),
  );

  return (
    <DashboardClient
      asOfDate={asOfDate}
      fromDate={fromDate}
      warehouses={warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
      settings={settings}
      rows={rows}
      dailyTotals={dailyTotals}
      latestUploads={latestUploads}
      isAdmin={isAdmin}
      holidays={holidays}
      favoriteSkuIds={favoriteSkuIds}
      specialSchedules={specialSchedules}
    />
  );
}
