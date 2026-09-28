import { requireTenant } from '@/server/tenant';
import { listWarehouses } from '@/server/repositories/warehouse-repository';
import { CountEntry } from '@/components/segment-dashboards/count-entry';
import { todayKstDateString } from '@/lib/date';

export default async function CountPage() {
  const tenant = await requireTenant();
  const warehouses = await listWarehouses(tenant.orgId);
  return <CountEntry today={todayKstDateString()} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} />;
}
