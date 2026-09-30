import { requireTenant } from '@/server/tenant';
import { getPeriodicRows } from '@/server/services/periodic-service';
import { listWarehouses } from '@/server/repositories/warehouse-repository';
import { PeriodicDashboard } from '@/components/segment-dashboards/periodic-dashboard';
import { todayKstDateString } from '@/lib/date';
import { parseDashboardRange } from '@/lib/dashboard-range';
import { comparePeriodicRange } from '@/domain/segments/range-compare';
import { requireEnabledSegment } from '@/server/segments';

export default async function PeriodicDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { asOfDate, fromDate } = parseDashboardRange(params, todayKstDateString());
  const tenant = await requireTenant();
  await requireEnabledSegment(tenant.orgId, 'PERIODIC_COUNT');
  const [{ rows, stockoutSoonDays, recountDays }, warehouses, fromRows] = await Promise.all([
    getPeriodicRows(tenant.orgId, asOfDate),
    listWarehouses(tenant.orgId, 'PERIODIC_COUNT'),
    fromDate ? getPeriodicRows(tenant.orgId, fromDate).then((r) => r.rows) : Promise.resolve(null),
  ]);

  return (
    <PeriodicDashboard
      asOfDate={asOfDate}
      fromDate={fromDate}
      rangeSummary={fromDate && fromRows ? comparePeriodicRange(fromRows, rows, fromDate, asOfDate) : null}
      stockoutSoonDays={stockoutSoonDays}
      recountDays={recountDays}
      rows={rows}
      warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
    />
  );
}
