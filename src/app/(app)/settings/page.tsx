import { requireTenant } from '@/server/tenant';
import { ensureSegmentWarehouse, listWarehouses, type StockSegment } from '@/server/repositories/warehouse-repository';
import { getSegmentSettings, getSettings } from '@/server/repositories/settings-repository';
import { listUsers } from '@/server/repositories/user-repository';
import { listAllSkusForVisibilityAdmin } from '@/server/repositories/inventory-repository';
import { listExpirationLots } from '@/server/repositories/expiration-repository';
import { listPackagingUploadStatus } from '@/server/repositories/packaging-repository';
import { getOrganization } from '@/server/repositories/organization-repository';
import { listStoreItemExtras, listSuppliers } from '@/server/repositories/store-repository';
import { getReorderDefaults, listSupplierPolicies } from '@/server/repositories/reorder-repository';
import { getAccountStatus } from '@/server/repositories/account-repository';
import { listRegisteredCosts } from '@/server/repositories/cost-repository';
import { listMergeLinks } from '@/server/repositories/merge-repository';
import { listImportTemplates } from '@/server/repositories/import-template-repository';
import { listCodeAliases } from '@/server/repositories/code-alias-repository';
import { getStoreItemLearning } from '@/server/services/store-service';
import { CommonSettings, DailySettings } from '@/components/settings/settings-form';
import { PeriodicSettings, StoreSettings } from '@/components/settings/segment-settings';
import { SettingsTabs } from '@/components/settings/settings-tabs';
import { isSettingsTab, SEGMENT_TAB } from '@/lib/settings-tabs';
import { todayKstDateString } from '@/lib/date';
import { getMessages } from '@/server/i18n';
import { getSegmentContext } from '@/server/segments';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const isAdmin = tenant.isAdmin;
  const t = (await getMessages()).settingsScreens.page;
  const params = await searchParams;

  // 켜 둔 재고 방식에 창고가 없으면 기본 창고를 만들어 둔다(예: 일일 재고 연동으로 가입한 뒤 비정기 실사를 켠 경우).
  const segmentContext = await getSegmentContext(tenant.orgId);
  const defaultWarehouseName = (await getMessages()).domain.defaultWarehouse;
  for (const segment of ['DAILY_SYNC', 'PERIODIC_COUNT'] as const) {
    if (segmentContext.enabled.includes(segment)) await ensureSegmentWarehouse(tenant.orgId, segment, defaultWarehouseName);
  }
  /** 방식별 창고·업로드 양식·원가·소비기한·포장 정보. */
  const loadStock = async (segment: StockSegment) => {
    const [warehouses, importTemplates, costs, expirations, packagingStatuses] = await Promise.all([
      listWarehouses(tenant.orgId, segment),
      listImportTemplates(tenant.orgId, segment),
      listRegisteredCosts(tenant.orgId, segment),
      listExpirationLots(tenant.orgId, segment),
      listPackagingUploadStatus(tenant.orgId, segment),
    ]);
    return { warehouses: warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name })), importTemplates, costs, expirations, packagingStatuses };
  };

  const [
    organization,
    dailyStock,
    periodicStock,
    settings,
    segmentSettings,
    users,
    skus,
    suppliers,
    storeItems,
    codeAliases,
    reorderDefaults,
    supplierPolicies,
    account,
    mergeLinks,
    storeExtras,
  ] = await Promise.all([
    getOrganization(tenant.orgId),
    loadStock('DAILY_SYNC'),
    loadStock('PERIODIC_COUNT'),
    getSettings(tenant.orgId),
    getSegmentSettings(tenant.orgId),
    isAdmin ? listUsers(tenant.orgId) : Promise.resolve([]),
    listAllSkusForVisibilityAdmin(tenant.orgId),
    listSuppliers(tenant.orgId),
    getStoreItemLearning(tenant.orgId, todayKstDateString()),
    listCodeAliases(tenant.orgId),
    getReorderDefaults(tenant.orgId),
    listSupplierPolicies(tenant.orgId),
    getAccountStatus(tenant.userId),
    listMergeLinks(tenant.orgId),
    listStoreItemExtras(tenant.orgId),
  ]);

  // 탭을 지정하지 않고 들어오면 지금 보고 있는 대시보드의 설정부터 보여준다.
  const { enabled: enabledSegments, active: activeSegment } = segmentContext;
  const requestedTab = isSettingsTab(params.tab) ? params.tab : SEGMENT_TAB[activeSegment];
  // 꺼 둔 방식의 탭은 없으므로, 그 탭을 주소로 요청해도 공통 탭을 연다.
  const initialTab = requestedTab === 'common' || enabledSegments.some((s) => SEGMENT_TAB[s] === requestedTab) ? requestedTab : 'common';

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{t.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.intro}
          {isAdmin ? '' : t.adminOnly}</p>
      </div>
      <SettingsTabs
        initialTab={initialTab}
        activeSegment={activeSegment}
        enabledSegments={enabledSegments}
        common={
          <CommonSettings
            isAdmin={isAdmin}
            enabledSegments={enabledSegments}
            currentUserId={tenant.userId}
            users={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
            allowNonWorkingDayUploads={segmentSettings.allowNonWorkingDayUploads}
            account={tenant.actingAs || !account ? null : { email: account.email, verified: !!account.emailVerifiedAt, workspaceName: organization.name }}
          />
        }
        daily={
          <DailySettings
            isAdmin={isAdmin}
            stock={dailyStock}
            mergeLinks={mergeLinks}
            settings={settings}
            skus={skus}
            codeAliases={codeAliases}
            reorderDefaults={reorderDefaults}
            supplierPolicies={supplierPolicies}
          />
        }
        periodic={<PeriodicSettings isAdmin={isAdmin} recountDays={segmentSettings.periodicRecountDays} stockoutSoonDays={settings.stockoutSoonDays} stock={periodicStock} />}
        store={<StoreSettings isAdmin={isAdmin} checkRemainingPct={segmentSettings.storeCheckRemainingPct} suppliers={suppliers} items={storeItems} extras={storeExtras} />}
      />
    </div>
  );
}
