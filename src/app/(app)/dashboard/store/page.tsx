import { requireTenant } from '@/server/tenant';
import { getStoreDashboard } from '@/server/services/store-service';
import { StoreDashboard } from '@/components/segment-dashboards/store-dashboard';
import { isDateString, todayKstDateString } from '@/lib/date';
import { requireEnabledSegment } from '@/server/segments';

export default async function StoreDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const today = todayKstDateString();
  const asOfDate = isDateString(params.date) && params.date <= today ? params.date : today;
  const tenant = await requireTenant();
  await requireEnabledSegment(tenant.orgId, 'ORDER_CYCLE');
  const data = await getStoreDashboard(tenant.orgId, asOfDate);
  return <StoreDashboard asOfDate={asOfDate} {...data} />;
}
