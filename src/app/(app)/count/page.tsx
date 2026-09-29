import { requireTenant } from '@/server/tenant';
import { ViewerNotice } from '@/components/auth/viewer-notice';
import { getMessages } from '@/server/i18n';
import { listWarehouses } from '@/server/repositories/warehouse-repository';
import { CountEntry } from '@/components/segment-dashboards/count-entry';
import { todayKstDateString } from '@/lib/date';

export default async function CountPage() {
  const tenant = await requireTenant();
  const warehouses = await listWarehouses(tenant.orgId);
  return (
    <div className="space-y-4">
      {tenant.role === 'VIEWER' && <ViewerNotice message={(await getMessages()).account.viewerNotice} />}
      <CountEntry today={todayKstDateString()} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} />
    </div>
  );
}
