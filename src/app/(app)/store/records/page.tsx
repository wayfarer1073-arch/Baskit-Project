import { addDays, format, parseISO } from 'date-fns';
import { requireTenant } from '@/server/tenant';
import { listDailySales, listRecentOrders } from '@/server/repositories/store-repository';
import { getStoreItemLearning } from '@/server/services/store-service';
import { StoreRecords } from '@/components/segment-dashboards/store-records';
import { todayKstDateString } from '@/lib/date';

export default async function StoreRecordsPage() {
  const tenant = await requireTenant();
  const today = todayKstDateString();
  const [items, orders, sales] = await Promise.all([
    getStoreItemLearning(tenant.orgId, today),
    listRecentOrders(tenant.orgId),
    listDailySales(tenant.orgId, format(addDays(parseISO(today), -20), 'yyyy-MM-dd')),
  ]);
  return <StoreRecords today={today} items={items} orders={orders} sales={[...sales].reverse()} />;
}
