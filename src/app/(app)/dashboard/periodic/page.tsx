import { requireTenant } from '@/server/tenant';
import { getPeriodicRows } from '@/server/services/periodic-service';
import { listWarehouses } from '@/server/repositories/warehouse-repository';
import { PeriodicDashboard } from '@/components/segment-dashboards/periodic-dashboard';
import { isDateString, todayKstDateString } from '@/lib/date';
import { requireEnabledSegment } from '@/server/segments';

export default async function PeriodicDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const today = todayKstDateString();
  const asOfDate = isDateString(params.date) && params.date <= today ? params.date : today;
  const tenant = await requireTenant();
  await requireEnabledSegment(tenant.orgId, 'PERIODIC_COUNT');
  const [{ rows, stockoutSoonDays, recountDays }, warehouses] = await Promise.all([getPeriodicRows(tenant.orgId, asOfDate), listWarehouses(tenant.orgId, 'PERIODIC_COUNT')]);

  return (
    <PeriodicDashboard
      asOfDate={asOfDate}
      stockoutSoonDays={stockoutSoonDays}
      recountDays={recountDays}
      rows={rows}
      warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
    />
  );
}
