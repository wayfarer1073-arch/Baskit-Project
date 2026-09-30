'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { ExpirationManagement } from '@/components/settings/expiration-management';
import { SkuPackagingManagement } from '@/components/settings/sku-packaging-management';
import { HolidayManagement } from '@/components/settings/holiday-management';
import { WarehouseManagement } from '@/components/settings/warehouse-management';
import { HolidayUploadToggle } from '@/components/settings/holiday-upload-toggle';
import { EnabledSegments } from '@/components/settings/enabled-segments';
import type { Segment } from '@/lib/segments';
import { ImportTemplateManagement, type ImportTemplateView } from '@/components/settings/import-template-management';
import { CodeAliasManagement, type CodeAliasView } from '@/components/settings/code-alias-management';
import { TeamInvitations } from '@/components/settings/team-invitations';
import { AccountDangerZone } from '@/components/settings/account-danger-zone';
import { CostManagement, type CostRowView } from '@/components/settings/cost-management';
import { MergeLinkManagement, type MergeLinkView } from '@/components/settings/merge-link-management';
import { ReorderSettings, type ReorderDefaults } from '@/components/settings/reorder-settings';
import type { SupplierPolicyRow } from '@/domain/reorder/reorder';
import type { RiskThresholdSettings } from '@/domain/inventory/types';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { Paged } from '@/components/ui/paged';

interface SkuVisibilityRow {
  skuId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  isActive: boolean;
  isHiddenFromDashboard: boolean;
}

interface ExpirationLotRow {
  lotId: string;
  skuId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  lot: string;
  isAutoLot: boolean;
  expirationDate: string;
  expirationRiskDays: number | null;
}

interface PackagingUploadStatus {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  lastUpload: { uploadedAt: string; uploadedByName: string; sourceFileName: string; rowCount: number } | null;
}

type UserRow = { id: string; email: string; name: string; role: 'VIEWER' | 'MEMBER' | 'ADMIN'; createdAt: string };

/** 공통 탭 — 어떤 대시보드를 쓰든 필요한 워크스페이스 설정(창고, 휴무일, 업로드 양식, 사용자). */
export function CommonSettings({
  isAdmin,
  enabledSegments,
  currentUserId,
  warehouses,
  users: initialUsers,
  account,
  holidays,
  allowNonWorkingDayUploads,
  importTemplates,
  costs,
  mergeLinks,
}: {
  isAdmin: boolean;
  enabledSegments: Segment[];
  currentUserId: string | null;
  warehouses: { id: string; code: string; name: string }[];
  users: UserRow[];
  account: { email: string; verified: boolean; workspaceName: string } | null;
  holidays: { id: string; date: string; name: string }[];
  allowNonWorkingDayUploads: boolean;
  importTemplates: ImportTemplateView[];
  costs: CostRowView[];
  mergeLinks: MergeLinkView[];
}) {
  const [users, setUsers] = useState(initialUsers);
  // 끈 방식에만 쓰이는 카드는 숨긴다(데이터는 그대로). 창고·업로드 양식·원가는 재고 파일을 쓰는 두 방식 공용.
  const usesStock = enabledSegments.includes('DAILY_SYNC') || enabledSegments.includes('PERIODIC_COUNT');
  const usesDaily = enabledSegments.includes('DAILY_SYNC');
  return (
    <div className="space-y-6">
      <EnabledSegments isAdmin={isAdmin} enabled={enabledSegments} />
      {usesStock && <WarehouseManagement key={warehouses.map((w) => `${w.id}:${w.name}`).join('|')} isAdmin={isAdmin} warehouses={warehouses} />}
      {usesStock && <HolidayUploadToggle isAdmin={isAdmin} initial={allowNonWorkingDayUploads} />}
      <HolidayManagement isAdmin={isAdmin} initialHolidays={holidays} />
      {usesStock && <ImportTemplateManagement templates={importTemplates} />}
      {usesStock && <CostManagement costs={costs} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} isAdmin={isAdmin} />}
      {usesDaily && warehouses.length > 1 && <MergeLinkManagement links={mergeLinks} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} isAdmin={isAdmin} />}
      {isAdmin && <UserManagement users={users} onUsersChange={setUsers} currentUserId={currentUserId} />}
      {isAdmin && <TeamInvitations />}
      {account && <AccountDangerZone email={account.email} verified={account.verified} isAdmin={isAdmin} workspaceName={account.workspaceName} />}
    </div>
  );
}

interface DailySettingsProps {
  isAdmin: boolean;
  warehouses: { id: string; code: string; name: string }[];
  settings: RiskThresholdSettings;
  skus: SkuVisibilityRow[];
  expirations: ExpirationLotRow[];
  packagingStatuses: PackagingUploadStatus[];
  codeAliases: CodeAliasView[];
  reorderDefaults: ReorderDefaults;
  supplierPolicies: SupplierPolicyRow[];
}

/** 일일 재고 연동 탭 — 매일 받는 재고 파일로 판단하는 대시보드의 기준과 SKU 관리. */
export function DailySettings({
  isAdmin,
  warehouses,
  settings,
  skus,
  expirations,
  packagingStatuses,
  codeAliases,
  reorderDefaults,
  supplierPolicies,
}: DailySettingsProps) {
  const { m } = useI18n();
  const t = m.settingsScreens;
  const [thresholds, setThresholds] = useState(settings);
  const [savingThresholds, setSavingThresholds] = useState(false);

  async function saveThresholds() {
    setSavingThresholds(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thresholds),
      });
      if (!res.ok) throw new Error();
      toast.success(t.thresholds.saved);
    } catch {
      toast.error(t.common.saveFailed);
    } finally {
      setSavingThresholds(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>{t.thresholds.title}</CardTitle>
            <InfoTooltip className="text-brand-accent hover:text-brand-accent/80">
              {t.thresholds.description}
            </InfoTooltip>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ThresholdField
            label={t.thresholds.stockoutSoon}
            value={thresholds.stockoutSoonDays}
            onChange={(v) => setThresholds((p) => ({ ...p, stockoutSoonDays: v }))}
            disabled={!isAdmin}
          />
          <ThresholdField
            label={t.thresholds.manageMax}
            value={thresholds.manageMaxDays}
            onChange={(v) => setThresholds((p) => ({ ...p, manageMaxDays: v }))}
            disabled={!isAdmin}
          />
          <ThresholdField
            label={t.thresholds.overstock}
            value={thresholds.overstockCoverageDays}
            onChange={(v) => setThresholds((p) => ({ ...p, overstockCoverageDays: v }))}
            disabled={!isAdmin}
          />
          <ThresholdField
            label={t.thresholds.stagnant}
            value={thresholds.stagnantDays}
            onChange={(v) => setThresholds((p) => ({ ...p, stagnantDays: v }))}
            disabled={!isAdmin}
          />
        </CardContent>
        {isAdmin && (
          <CardContent className="pt-0">
            <Button onClick={saveThresholds} disabled={savingThresholds}>
              {savingThresholds ? t.common.saving : t.thresholds.submit}
            </Button>
          </CardContent>
        )}
      </Card>

      <ReorderSettings isAdmin={isAdmin} defaults={reorderDefaults} suppliers={supplierPolicies} />

      <SkuVisibilityManagement isAdmin={isAdmin} initialSkus={skus} />

      <ExpirationManagement isAdmin={isAdmin} warehouses={warehouses} initialEntries={expirations} />

      <SkuPackagingManagement isAdmin={isAdmin} warehouses={warehouses} initialStatuses={packagingStatuses} />

      <CodeAliasManagement aliases={codeAliases} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} />

    </div>
  );
}

function ThresholdField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  const id = `threshold-${label.replace(/[^a-zA-Z0-9가-힣]+/g, '-')}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min={1} value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} />
    </div>
  );
}

const HIDDEN_SKU_PAGE_SIZE = 7;

function SkuVisibilityManagement({ isAdmin, initialSkus }: { isAdmin: boolean; initialSkus: SkuVisibilityRow[] }) {
  const { m } = useI18n();
  const t = m.settingsScreens;
  const [skus, setSkus] = useState(initialSkus);
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selected, setSelected] = useState<SkuVisibilityRow | null>(null);
  const [updatingSkuId, setUpdatingSkuId] = useState<string | null>(null);
  const [hiddenPage, setHiddenPage] = useState(1);
  const searchWrapperRef = useRef<HTMLDivElement>(null);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const hiddenSkus = useMemo(
    () => skus.filter((s) => s.isHiddenFromDashboard).sort((a, b) => a.warehouseCode.localeCompare(b.warehouseCode) || a.productCode.localeCompare(b.productCode)),
    [skus],
  );
  const hiddenTotalPages = Math.max(1, Math.ceil(hiddenSkus.length / HIDDEN_SKU_PAGE_SIZE));
  const hiddenCurrentPage = Math.min(hiddenPage, hiddenTotalPages);
  const hiddenPageSkus = hiddenSkus.slice((hiddenCurrentPage - 1) * HIDDEN_SKU_PAGE_SIZE, hiddenCurrentPage * HIDDEN_SKU_PAGE_SIZE);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return skus.filter((s) => !s.isHiddenFromDashboard && (s.productCode.toLowerCase().includes(q) || s.productName.toLowerCase().includes(q))).slice(0, 20);
  }, [skus, query]);

  const dropdownVisible = showDropdown && !selected && query.trim() !== '';

  // 드롭다운을 Card의 overflow-hidden 클리핑 밖으로 포털링하기 위해 뷰포트 기준 위치를 계산한다.
  useEffect(() => {
    if (!dropdownVisible) return;
    function updatePosition() {
      const rect = searchWrapperRef.current?.getBoundingClientRect();
      if (rect) setDropdownRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [dropdownVisible]);

  async function setHidden(skuId: string, hidden: boolean) {
    setUpdatingSkuId(skuId);
    try {
      const res = await fetch(`/api/sku/${skuId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHiddenFromDashboard: hidden }),
      });
      if (!res.ok) throw new Error();
      setSkus((prev) => prev.map((s) => (s.skuId === skuId ? { ...s, isHiddenFromDashboard: hidden } : s)));
      toast.success(hidden ? t.visibility.hidden : t.visibility.shown);
      if (selected?.skuId === skuId) {
        setSelected(null);
        setQuery('');
      }
    } catch {
      toast.error(t.common.changeFailed);
    } finally {
      setUpdatingSkuId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>{t.visibility.title}</CardTitle>
          <InfoTooltip className="text-brand-accent hover:text-brand-accent/80">
            {t.visibility.description}
          </InfoTooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>
            {t.visibility.hiddenList} {hiddenSkus.length > 0 && `(${hiddenSkus.length})`}
          </Label>
          {hiddenSkus.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.visibility.noneHidden}</p>
          ) : (
            <>
              <div className="space-y-1.5">
                {hiddenPageSkus.map((sku) => (
                  <SkuVisibilityItem key={sku.skuId} sku={sku} isAdmin={isAdmin} updating={updatingSkuId === sku.skuId} onToggle={(hidden) => setHidden(sku.skuId, hidden)} />
                ))}
              </div>
              {hiddenTotalPages > 1 && (
                <div className="flex items-center justify-center gap-2 text-sm">
                  <Button variant="outline" size="sm" disabled={hiddenCurrentPage <= 1} onClick={() => setHiddenPage(hiddenCurrentPage - 1)}>
                    {t.common.prev}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {hiddenCurrentPage} / {hiddenTotalPages}
                  </span>
                  <Button variant="outline" size="sm" disabled={hiddenCurrentPage >= hiddenTotalPages} onClick={() => setHiddenPage(hiddenCurrentPage + 1)}>
                    {t.common.next}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {isAdmin && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="sku-visibility-search">{t.visibility.searchLabel}</Label>
              <div className="flex max-w-sm items-start gap-2">
                <div ref={searchWrapperRef} className="min-w-0 flex-1">
                  <Input
                    id="sku-visibility-search"
                    placeholder={t.visibility.searchPlaceholder}
                    value={selected ? `${selected.warehouseCode} · ${selected.productName} (${selected.productCode})` : query}
                    onChange={(e) => {
                      setSelected(null);
                      setQuery(e.target.value);
                      setShowDropdown(true);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                  />
                  {dropdownVisible &&
                    dropdownRect &&
                    typeof document !== 'undefined' &&
                    createPortal(
                      <div
                        className="fixed z-50 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md"
                        style={{ top: dropdownRect.top, left: dropdownRect.left, width: dropdownRect.width }}
                      >
                        {searchResults.length === 0 ? (
                          <p className="p-2 text-xs text-muted-foreground">{t.visibility.noMatch}</p>
                        ) : (
                          searchResults.map((sku) => (
                            <button
                              key={sku.skuId}
                              type="button"
                              className="block w-full px-2.5 py-1.5 text-left text-xs hover:bg-muted"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setSelected(sku);
                                setShowDropdown(false);
                              }}
                            >
                              <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">{sku.warehouseCode}</span>
                              <span className="font-medium">{sku.productName}</span> <span className="text-muted-foreground">{sku.productCode}</span>
                            </button>
                          ))
                        )}
                      </div>,
                      document.body,
                    )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!selected || updatingSkuId === selected?.skuId}
                  onClick={() => selected && setHidden(selected.skuId, true)}
                >
                  {t.visibility.hide}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SkuVisibilityItem({ sku, isAdmin, updating, onToggle }: { sku: SkuVisibilityRow; isAdmin: boolean; updating: boolean; onToggle: (hidden: boolean) => void }) {
  const t = useI18n().m.settingsScreens;
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="shrink-0 text-[11px]">
            {sku.warehouseCode}
          </Badge>
          <span className="truncate font-medium">{sku.productName}</span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {sku.productCode}
          {!sku.isActive && t.visibility.notInLatest}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-muted-foreground">{sku.isHiddenFromDashboard ? t.visibility.stateHidden : t.visibility.stateShown}</span>
        <Switch checked={sku.isHiddenFromDashboard} onCheckedChange={onToggle} disabled={!isAdmin || updating} aria-label={format(t.visibility.toggleAria, { name: sku.productName })} />
      </div>
    </div>
  );
}

function UserManagement({
  users,
  onUsersChange,
  currentUserId,
}: {
  users: { id: string; email: string; name: string; role: 'VIEWER' | 'MEMBER' | 'ADMIN'; createdAt: string }[];
  onUsersChange: (users: { id: string; email: string; name: string; role: 'VIEWER' | 'MEMBER' | 'ADMIN'; createdAt: string }[]) => void;
  currentUserId: string | null;
}) {
  const { m } = useI18n();
  const t = m.settingsScreens;
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'VIEWER' | 'MEMBER' | 'ADMIN'>('MEMBER');
  const [submitting, setSubmitting] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  async function addUser() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, password, role }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? t.common.addFailed);
        return;
      }
      toast.success(t.users.added);
      onUsersChange([...users, body.user]);
      setEmail('');
      setName('');
      setPassword('');
      setRole('MEMBER');
    } finally {
      setSubmitting(false);
    }
  }

  async function removeUser(user: { id: string; name: string }) {
    if (!confirm(format(t.users.deleteConfirm, { name: user.name }))) return;
    setDeletingUserId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? t.common.deleteFailed);
        return;
      }
      onUsersChange(users.filter((u) => u.id !== user.id));
      toast.success(t.users.deleted);
    } catch {
      toast.error(t.common.deleteNetworkFailed);
    } finally {
      setDeletingUserId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.users.title}</CardTitle>
        <CardDescription>{t.users.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Paged items={users}>
          {(pageItems) => (
            <div className="space-y-2">
              {pageItems.map((u) => {
                const isSelf = u.id === currentUserId;
                // 워크스페이스에 관리자가 한 명만 남으면 그 계정은 지울 수 없다(서버도 같은 규칙으로 막는다).
                const isProtected = u.role === 'ADMIN' && users.filter((x) => x.role === 'ADMIN').length <= 1;
                const disabledReason = isProtected ? t.users.lastAdmin : isSelf ? t.users.self : undefined;
                return (
                  <div key={u.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium">{u.name}</span> <span className="text-muted-foreground">{u.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{u.role === 'ADMIN' ? m.nav.roles.admin : u.role === 'VIEWER' ? m.nav.roles.viewer : m.nav.roles.member}</Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive disabled:text-muted-foreground"
                        disabled={isSelf || isProtected || deletingUserId === u.id}
                        onClick={() => removeUser(u)}
                        aria-label={format(t.users.deleteAria, { name: u.name })}
                        title={disabledReason}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Paged>
        <Separator />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-user-email">{t.users.email}</Label>
            <Input id="new-user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-user-name">{t.users.name}</Label>
            <Input id="new-user-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-user-password">{t.users.password}</Label>
            <Input id="new-user-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-user-role">{t.users.role}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as 'VIEWER' | 'MEMBER' | 'ADMIN')}>
              <SelectTrigger id="new-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="VIEWER">{m.nav.roles.viewer}</SelectItem>
                <SelectItem value="MEMBER">{m.nav.roles.member}</SelectItem>
                <SelectItem value="ADMIN">{m.nav.roles.admin}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={addUser} disabled={submitting || !email || !name || password.length < 8}>
          {t.users.submit}
        </Button>
      </CardContent>
    </Card>
  );
}
