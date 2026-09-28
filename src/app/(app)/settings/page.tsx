import { requireTenant } from '@/server/tenant';
import { listWarehouses } from '@/server/repositories/warehouse-repository';
import { getSettings } from '@/server/repositories/settings-repository';
import { listUsers } from '@/server/repositories/user-repository';
import { listAllSkusForVisibilityAdmin } from '@/server/repositories/inventory-repository';
import { listExpirationLots } from '@/server/repositories/expiration-repository';
import { listHolidays } from '@/server/repositories/holiday-repository';
import { listPackagingUploadStatus } from '@/server/repositories/packaging-repository';
import { SettingsForm } from '@/components/settings/settings-form';

export default async function SettingsPage() {
  const tenant = await requireTenant();
  const isAdmin = tenant.isAdmin;

  const [warehouses, settings, users, skus, expirations, holidays, packagingStatuses] = await Promise.all([
    listWarehouses(tenant.orgId),
    getSettings(tenant.orgId),
    isAdmin ? listUsers(tenant.orgId) : Promise.resolve([]),
    listAllSkusForVisibilityAdmin(tenant.orgId),
    listExpirationLots(tenant.orgId),
    listHolidays(tenant.orgId),
    listPackagingUploadStatus(tenant.orgId),
  ]);

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold">설정</h1>
        <p className="mt-1 text-sm text-muted-foreground">{isAdmin ? '창고명과 위험/정체 판단 기준을 관리합니다.' : '현재 적용된 설정을 확인할 수 있습니다. 변경은 관리자만 가능합니다.'}</p>
      </div>
      <SettingsForm
        isAdmin={isAdmin}
        currentUserId={tenant.userId}
        warehouses={warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
        settings={settings}
        users={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
        skus={skus}
        expirations={expirations}
        holidays={holidays}
        packagingStatuses={packagingStatuses}
      />
    </div>
  );
}
