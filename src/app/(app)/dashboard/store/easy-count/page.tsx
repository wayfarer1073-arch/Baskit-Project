import { requireTenant } from '@/server/tenant';
import { requireEnabledSegment } from '@/server/segments';
import { getEasyCountSheet } from '@/server/repositories/store-repository';
import { EasyCount } from '@/components/segment-dashboards/easy-count';
import { isDateString, todayKstDateString } from '@/lib/date';

/** Easy Count — 매장 품목 재고를 한 장에 적는 수첩. ?date=로 지난 날짜도 고칠 수 있다(미래는 오늘로). */
export default async function EasyCountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const today = todayKstDateString();
  const date = isDateString(params.date) && params.date <= today ? params.date : today;
  const tenant = await requireTenant();
  await requireEnabledSegment(tenant.orgId, 'ORDER_CYCLE');
  const items = await getEasyCountSheet(tenant.orgId, date);
  return <EasyCount key={date} date={date} today={today} items={items} readOnly={tenant.role === 'VIEWER'} />;
}
