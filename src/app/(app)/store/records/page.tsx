import { addDays, format, parseISO } from 'date-fns';
import { requireTenant } from '@/server/tenant';
import { listDailySales, listRecentOrders, listStoreItemsWithOrders } from '@/server/repositories/store-repository';
import { StoreRecords } from '@/components/segment-dashboards/store-records';
import { todayKstDateString } from '@/lib/date';

export default async function StoreRecordsPage() {
  const tenant = await requireTenant();
  const today = todayKstDateString();
  const [items, orders, sales] = await Promise.all([
    listStoreItemsWithOrders(tenant.orgId),
    listRecentOrders(tenant.orgId),
    listDailySales(tenant.orgId, format(addDays(parseISO(today), -20), 'yyyy-MM-dd')),
  ]);
  return (
    <StoreRecords
      today={today}
      items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, leadTimeDays: i.leadTimeDays, orderCount: i.orders.length }))}
      orders={orders}
      sales={[...sales].reverse()}
    />
  );
}
