import { requireTenant } from '@/server/tenant';
import { getStoreDashboard, getStoreRangeSummary } from '@/server/services/store-service';
import { StoreDashboard } from '@/components/segment-dashboards/store-dashboard';
import { todayKstDateString } from '@/lib/date';
import { parseDashboardRange } from '@/lib/dashboard-range';
import { requireEnabledSegment } from '@/server/segments';

export default async function StoreDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { asOfDate, fromDate } = parseDashboardRange(params, todayKstDateString());
  const tenant = await requireTenant();
  await requireEnabledSegment(tenant.orgId, 'ORDER_CYCLE');
  const [data, rangeSummary] = await Promise.all([
    getStoreDashboard(tenant.orgId, asOfDate),
    fromDate ? getStoreRangeSummary(tenant.orgId, fromDate, asOfDate) : Promise.resolve(null),
  ]);
  return <StoreDashboard asOfDate={asOfDate} fromDate={fromDate} rangeSummary={rangeSummary} {...data} />;
}
