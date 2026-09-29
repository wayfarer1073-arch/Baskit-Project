import { cookies } from 'next/headers';
import { requireTenant } from '@/server/tenant';
import { listWarehouses } from '@/server/repositories/warehouse-repository';
import { getSegmentSettings, getSettings } from '@/server/repositories/settings-repository';
import { listUsers } from '@/server/repositories/user-repository';
import { listAllSkusForVisibilityAdmin } from '@/server/repositories/inventory-repository';
import { listExpirationLots } from '@/server/repositories/expiration-repository';
import { listHolidays } from '@/server/repositories/holiday-repository';
import { listPackagingUploadStatus } from '@/server/repositories/packaging-repository';
import { getOrganization } from '@/server/repositories/organization-repository';
import { listSuppliers } from '@/server/repositories/store-repository';
import { getReorderDefaults, listSupplierPolicies } from '@/server/repositories/reorder-repository';
import { getAccountStatus } from '@/server/repositories/account-repository';
import { listImportTemplates } from '@/server/repositories/import-template-repository';
import { listCodeAliases } from '@/server/repositories/code-alias-repository';
import { getStoreItemLearning } from '@/server/services/store-service';
import { CommonSettings, DailySettings } from '@/components/settings/settings-form';
import { PeriodicSettings, StoreSettings } from '@/components/settings/segment-settings';
import { SettingsTabs } from '@/components/settings/settings-tabs';
import { isSettingsTab, SEGMENT_TAB } from '@/lib/settings-tabs';
import { SEGMENT_COOKIE, isSegment } from '@/lib/segments';
import { todayKstDateString } from '@/lib/date';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const isAdmin = tenant.isAdmin;
  const params = await searchParams;

  const [
    organization,
    warehouses,
    settings,
    segmentSettings,
    users,
    skus,
    expirations,
    holidays,
    packagingStatuses,
    suppliers,
    storeItems,
    importTemplates,
    codeAliases,
    reorderDefaults,
    supplierPolicies,
    account,
  ] = await Promise.all([
    getOrganization(tenant.orgId),
    listWarehouses(tenant.orgId),
    getSettings(tenant.orgId),
    getSegmentSettings(tenant.orgId),
    isAdmin ? listUsers(tenant.orgId) : Promise.resolve([]),
    listAllSkusForVisibilityAdmin(tenant.orgId),
    listExpirationLots(tenant.orgId),
    listHolidays(tenant.orgId),
    listPackagingUploadStatus(tenant.orgId),
    listSuppliers(tenant.orgId),
    getStoreItemLearning(tenant.orgId, todayKstDateString()),
    listImportTemplates(tenant.orgId),
    listCodeAliases(tenant.orgId),
    getReorderDefaults(tenant.orgId),
    listSupplierPolicies(tenant.orgId),
    getAccountStatus(tenant.userId),
  ]);

  // 탭을 지정하지 않고 들어오면 지금 보고 있는 대시보드의 설정부터 보여준다.
  const remembered = (await cookies()).get(SEGMENT_COOKIE)?.value;
  const activeSegment = isSegment(remembered) ? remembered : organization.segment;
  const initialTab = isSettingsTab(params.tab) ? params.tab : SEGMENT_TAB[activeSegment];
  const warehouseRows = warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">설정</h1>
        <p className="mt-1 text-sm text-muted-foreground">대시보드마다 필요한 설정을 나눠 두었어요.{isAdmin ? '' : ' 판단 기준 변경은 관리자만 할 수 있어요.'}</p>
      </div>
      <SettingsTabs
        initialTab={initialTab}
        activeSegment={activeSegment}
        common={
          <CommonSettings
            isAdmin={isAdmin}
            currentUserId={tenant.userId}
            warehouses={warehouseRows}
            users={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
            holidays={holidays}
            allowNonWorkingDayUploads={segmentSettings.allowNonWorkingDayUploads}
            importTemplates={importTemplates}
            account={tenant.actingAs || !account ? null : { email: account.email, verified: !!account.emailVerifiedAt, workspaceName: organization.name }}
          />
        }
        daily={
          <DailySettings
            isAdmin={isAdmin}
            warehouses={warehouseRows}
            settings={settings}
            skus={skus}
            expirations={expirations}
            packagingStatuses={packagingStatuses}
            codeAliases={codeAliases}
            reorderDefaults={reorderDefaults}
            supplierPolicies={supplierPolicies}
          />
        }
        periodic={<PeriodicSettings isAdmin={isAdmin} recountDays={segmentSettings.periodicRecountDays} stockoutSoonDays={settings.stockoutSoonDays} />}
        store={<StoreSettings isAdmin={isAdmin} checkRemainingPct={segmentSettings.storeCheckRemainingPct} suppliers={suppliers} items={storeItems} />}
      />
    </div>
  );
}
