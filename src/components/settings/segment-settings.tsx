'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { StoreItemLearning, SupplierRow } from '@/domain/segments/read-model';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? '');
  return data;
}

function useRunner() {
  const router = useRouter();
  const requestFailed = useI18n().m.settingsScreens.common.requestFailed;
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      router.refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : requestFailed);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

/** 숫자 하나를 고치고 저장하는 설정 카드 — 세그먼트 탭의 판단 기준에 쓴다. */
function NumberSettingCard({
  title,
  description,
  label,
  suffix,
  value,
  min,
  max,
  field,
  isAdmin,
  hint,
}: {
  title: string;
  description: string;
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  field: string;
  isAdmin: boolean;
  hint?: (v: number) => string;
}) {
  const t = useI18n().m.settingsScreens;
  const [draft, setDraft] = useState(String(value));
  const { busy, run } = useRunner();
  const n = Number(draft);
  const valid = Number.isInteger(n) && n >= min && n <= max;
  const id = `setting-${field}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) run(() => send('/api/settings', 'PATCH', { [field]: n }), t.common.saved);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            <div className="flex items-center gap-2">
              <Input id={id} type="number" min={min} max={max} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!isAdmin} className="w-24" />
              <span className="text-sm text-muted-foreground">{suffix}</span>
            </div>
          </div>
          {isAdmin && (
            <Button type="submit" size="sm" disabled={busy || !valid || n === value}>
              {t.common.save}
            </Button>
          )}
        </form>
        {hint && valid && <p className="mt-2 text-xs text-muted-foreground">{hint(n)}</p>}
        {!valid && (
          <p className="mt-2 text-xs text-status-danger">
            {format(t.segment.rangeHint, { min, max })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── 비정기 실사 ─────────────────────────────────────────────────────────────────────────────

export function PeriodicSettings({ isAdmin, recountDays, stockoutSoonDays }: { isAdmin: boolean; recountDays: number; stockoutSoonDays: number }) {
  const t = useI18n().m.settingsScreens.segment;
  return (
    <div className="space-y-6">
      <NumberSettingCard
        title={t.recountTitle}
        description={t.recountDescription}
        label={t.recountLabel}
        suffix={t.recountSuffix}
        value={recountDays}
        min={1}
        max={365}
        field="periodicRecountDays"
        isAdmin={isAdmin}
        hint={(v) => format(t.recountHint, { days: v })}
      />
      <NumberSettingCard
        title={t.stockoutTitle}
        description={t.stockoutDescription}
        label={t.stockoutLabel}
        suffix={t.stockoutSuffix}
        value={stockoutSoonDays}
        min={1}
        max={365}
        field="stockoutSoonDays"
        isAdmin={isAdmin}
      />
    </div>
  );
}

// ── 매장 발주 예측 ──────────────────────────────────────────────────────────────────────────

const NO_SUPPLIER = 'none';

export function StoreSettings({
  isAdmin,
  checkRemainingPct,
  suppliers,
  items,
}: {
  isAdmin: boolean;
  checkRemainingPct: number;
  suppliers: SupplierRow[];
  items: StoreItemLearning[];
}) {
  const { m, locale } = useI18n();
  const t = m.settingsScreens.segment;
  const hintAmount = (manwon: number) => (locale === 'ko' ? `${manwon}만 원` : `₩${(manwon * 10000).toLocaleString('en-US')}`);
  return (
    <div className="space-y-6">
      <NumberSettingCard
        title={t.orderTitle}
        description={t.orderDescription}
        label={t.orderLabel}
        suffix={t.orderSuffix}
        value={checkRemainingPct}
        min={5}
        max={80}
        field="storeCheckRemainingPct"
        isAdmin={isAdmin}
        hint={(v) => format(t.orderHint, { amount: hintAmount(Math.round(300 * (1 - v / 100))) })}
      />
      <SupplierManagement suppliers={suppliers} />
      <StoreItemManagement items={items} suppliers={suppliers} />
    </div>
  );
}

function SupplierManagement({ suppliers }: { suppliers: SupplierRow[] }) {
  const t = useI18n().m.settingsScreens;
  const { busy, run } = useRunner();
  const [drafts, setDrafts] = useState(Object.fromEntries(suppliers.map((s) => [s.id, { name: s.name, lead: String(s.leadTimeDays) }])));
  const [name, setName] = useState('');
  const [lead, setLead] = useState('1');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.suppliers.title}</CardTitle>
        <CardDescription>
          {t.suppliers.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {suppliers.length === 0 && <p className="text-sm text-muted-foreground">{t.suppliers.empty}</p>}
        {suppliers.map((s) => {
          const d = drafts[s.id] ?? { name: s.name, lead: String(s.leadTimeDays) };
          const changed = d.name.trim() !== s.name || Number(d.lead) !== s.leadTimeDays;
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={t.suppliers.nameAria}
                value={d.name}
                maxLength={50}
                onChange={(e) => setDrafts((p) => ({ ...p, [s.id]: { ...d, name: e.target.value } }))}
                className="w-44"
              />
              <div className="flex items-center gap-1.5">
                <Input
                  aria-label={format(t.suppliers.leadAria, { name: s.name })}
                  type="number"
                  min={0}
                  max={60}
                  value={d.lead}
                  onChange={(e) => setDrafts((p) => ({ ...p, [s.id]: { ...d, lead: e.target.value } }))}
                  className="w-20"
                />
                <span className="text-sm text-muted-foreground">{t.common.days}</span>
              </div>
              <span className="text-xs text-muted-foreground">{format(t.suppliers.itemCount, { count: s.itemCount })}</span>
              <div className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !changed}
                  onClick={() => run(() => send(`/api/store/suppliers/${s.id}`, 'PATCH', { name: d.name, leadTimeDays: Number(d.lead) }), t.suppliers.saved)}
                >
                  {t.common.save}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={busy}
                  aria-label={format(t.suppliers.deleteAria, { name: s.name })}
                  onClick={() =>
                    confirm(format(t.suppliers.deleteConfirm, { name: s.name }) + (s.itemCount ? format(t.suppliers.deleteLinked, { count: s.itemCount }) : '')) &&
                    run(() => send(`/api/store/suppliers/${s.id}`, 'DELETE'), t.suppliers.deleted)
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          );
        })}
        <form
          className="flex flex-wrap items-center gap-2 border-t pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => send('/api/store/suppliers', 'POST', { name, leadTimeDays: Number(lead) }), format(t.suppliers.added, { name }))) setName('');
          }}
        >
          <Input aria-label={t.suppliers.newAria} placeholder={t.suppliers.newPlaceholder} required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} className="w-44" />
          <div className="flex items-center gap-1.5">
            <Input aria-label={t.suppliers.newLeadAria} type="number" min={0} max={60} required value={lead} onChange={(e) => setLead(e.target.value)} className="w-20" />
            <span className="text-sm text-muted-foreground">{t.common.days}</span>
          </div>
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            <Plus className="size-4" />
            {t.suppliers.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

interface ItemDraft {
  name: string;
  unit: string;
  supplierId: string;
  lead: string;
}

function toDraft(i: StoreItemLearning): ItemDraft {
  return { name: i.name, unit: i.unit, supplierId: i.supplierId ?? NO_SUPPLIER, lead: String(i.itemLeadTimeDays) };
}

function payload(d: ItemDraft) {
  return { name: d.name, unit: d.unit, leadTimeDays: Number(d.lead), supplierId: d.supplierId === NO_SUPPLIER ? null : d.supplierId };
}

function ItemFields({ draft, onChange, suppliers, idPrefix }: { draft: ItemDraft; onChange: (d: ItemDraft) => void; suppliers: SupplierRow[]; idPrefix: string }) {
  const t = useI18n().m.settingsScreens;
  const supplier = suppliers.find((s) => s.id === draft.supplierId);
  return (
    <>
      <div className="col-span-2 space-y-1 sm:col-span-1">
        <Label htmlFor={`${idPrefix}-name`} className="text-xs">
          {t.items.name}
        </Label>
        <Input id={`${idPrefix}-name`} required maxLength={50} value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder={t.items.namePlaceholder} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-unit`} className="text-xs">
          {t.items.unit}
        </Label>
        <Input id={`${idPrefix}-unit`} required maxLength={10} value={draft.unit} onChange={(e) => onChange({ ...draft, unit: e.target.value })} placeholder={t.items.unitPlaceholder} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-supplier`} className="text-xs">
          {t.items.supplier}
        </Label>
        <Select value={draft.supplierId} onValueChange={(v) => onChange({ ...draft, supplierId: v })}>
          <SelectTrigger id={`${idPrefix}-supplier`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SUPPLIER}>{t.items.noSupplier}</SelectItem>
            {suppliers.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-lead`} className="text-xs">
          {t.items.lead}
        </Label>
        {supplier ? (
          <p id={`${idPrefix}-lead`} className="flex h-9 items-center text-sm text-muted-foreground">
            {format(t.items.supplierLead, { days: supplier.leadTimeDays })}
          </p>
        ) : (
          <div className="flex items-center gap-1.5">
            <Input
              id={`${idPrefix}-lead`}
              type="number"
              min={0}
              max={60}
              required
              value={draft.lead}
              onChange={(e) => onChange({ ...draft, lead: e.target.value })}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">{t.common.days}</span>
          </div>
        )}
      </div>
    </>
  );
}

function StoreItemManagement({ items, suppliers }: { items: StoreItemLearning[]; suppliers: SupplierRow[] }) {
  const t = useI18n().m.settingsScreens;
  const { busy, run } = useRunner();
  const [drafts, setDrafts] = useState(Object.fromEntries(items.map((i) => [i.id, toDraft(i)])));
  const empty: ItemDraft = { name: '', unit: t.items.defaultUnit, supplierId: NO_SUPPLIER, lead: '1' };
  const [draft, setDraft] = useState(empty);
  const grid = 'grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_0.6fr_1fr_0.8fr_auto] sm:items-end';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.items.title}</CardTitle>
        <CardDescription>{t.items.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">{t.items.empty}</p>}
        {items.map((i) => {
          const d = drafts[i.id] ?? toDraft(i);
          const original = toDraft(i);
          const changed = JSON.stringify(d) !== JSON.stringify(original);
          return (
            <div key={i.id} className={`${grid} rounded-lg border border-border p-3`}>
              <ItemFields draft={d} onChange={(next) => setDrafts((p) => ({ ...p, [i.id]: next }))} suppliers={suppliers} idPrefix={`item-${i.id}`} />
              <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !changed}
                  onClick={() => run(() => send(`/api/store/items/${i.id}`, 'PATCH', payload(d)), t.items.saved)}
                >
                  {t.common.save}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={busy}
                  aria-label={format(t.items.archiveAria, { name: i.name })}
                  title={t.items.archiveTitle}
                  onClick={() =>
                    confirm(format(t.items.archiveConfirm, { name: i.name })) && run(() => send(`/api/store/items/${i.id}`, 'DELETE'), t.items.archived)
                  }
                >
                  <Archive className="size-4" />
                </Button>
              </div>
              <p className="col-span-2 text-[11px] text-muted-foreground sm:col-span-5">
                {format(t.items.orders, { count: i.orderCount })}
                {i.learnedCycles > 0 ? format(t.items.learned, { count: i.learnedCycles }) : t.items.notLearned}
              </p>
            </div>
          );
        })}
        <form
          className={`${grid} border-t pt-3`}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => send('/api/store/items', 'POST', payload(draft)), format(t.items.added, { name: draft.name }))) setDraft(empty);
          }}
        >
          <ItemFields draft={draft} onChange={setDraft} suppliers={suppliers} idPrefix="new-item" />
          <Button type="submit" size="sm" disabled={busy || !draft.name.trim()} className="col-span-2 sm:col-span-1">
            <Plus className="size-4" />
            {t.items.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
