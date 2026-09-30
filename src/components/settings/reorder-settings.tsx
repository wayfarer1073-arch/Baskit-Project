'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import type { SupplierPolicyRow } from '@/domain/reorder/reorder';
import { Paged } from '@/components/ui/paged';

export interface ReorderDefaults {
  leadTimeDays: number;
  safetyDays: number;
  targetDays: number;
}

type SupplierField = 'leadTimeDays' | 'safetyDays' | 'targetDays' | 'minOrderQty' | 'orderMultiple';
const SUPPLIER_FIELDS: SupplierField[] = ['leadTimeDays', 'safetyDays', 'targetDays', 'minOrderQty', 'orderMultiple'];

async function request(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error);
  return data;
}

const toText = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const toNumber = (v: string) => (v.trim() === '' ? null : Number(v));

/** 일일 재고 연동의 권장 발주 기준 — 워크스페이스 기본값과 거래처별 기준(품목 예외는 품목 상세에서). */
export function ReorderSettings({ isAdmin, defaults, suppliers }: { isAdmin: boolean; defaults: ReorderDefaults; suppliers: SupplierPolicyRow[] }) {
  const { m } = useI18n();
  const t = m.reorderSettings;
  const f = m.reorder.fields;
  const router = useRouter();
  const [values, setValues] = useState({ leadTimeDays: String(defaults.leadTimeDays), safetyDays: String(defaults.safetyDays), targetDays: String(defaults.targetDays) });
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      toast.success(t.saved);
      router.refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t.failed);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function saveDefaults(e: React.FormEvent) {
    e.preventDefault();
    run(() =>
      request('/api/settings', 'PATCH', {
        reorderLeadTimeDays: Number(values.leadTimeDays),
        reorderSafetyDays: Number(values.safetyDays),
        reorderTargetDays: Number(values.targetDays),
      }),
    );
  }

  async function addSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (await run(() => request('/api/store/suppliers', 'POST', { name: newName, leadTimeDays: Number(values.leadTimeDays) || 0 }))) setNewName('');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={saveDefaults} className="space-y-2">
          <h3 className="text-sm font-medium">{t.defaults}</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end">
            {(['leadTimeDays', 'safetyDays', 'targetDays'] as const).map((key) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`reorder-default-${key}`} className="text-xs">
                  {f[key]}
                </Label>
                <Input
                  id={`reorder-default-${key}`}
                  type="number"
                  inputMode="numeric"
                  required
                  min={key === 'targetDays' ? 1 : 0}
                  max={365}
                  disabled={!isAdmin}
                  value={values[key]}
                  onChange={(e) => setValues((p) => ({ ...p, [key]: e.target.value }))}
                />
              </div>
            ))}
            {isAdmin && (
              <Button type="submit" disabled={busy}>
                {t.save}
              </Button>
            )}
          </div>
        </form>

        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">{t.suppliers}</h3>
          <p className="text-xs text-muted-foreground">{t.suppliersHint}</p>
          {suppliers.length > 0 && (
            <Paged items={suppliers} pagerClassName="mt-2">
              {(pageItems) => (
                <ul className="space-y-2">
                  {pageItems.map((s) => (
                    <SupplierPolicyEditor key={s.id} supplier={s} isAdmin={isAdmin} busy={busy} run={run} defaults={defaults} />
                  ))}
                </ul>
              )}
            </Paged>
          )}
          {isAdmin && (
            <form onSubmit={addSupplier} className="flex gap-2">
              <Input aria-label={t.newSupplier} placeholder={t.newSupplier} maxLength={50} value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Button type="submit" variant="outline" disabled={busy || !newName.trim()}>
                {t.addSupplier}
              </Button>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SupplierPolicyEditor({
  supplier,
  isAdmin,
  busy,
  run,
  defaults,
}: {
  supplier: SupplierPolicyRow;
  isAdmin: boolean;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  defaults: ReorderDefaults;
}) {
  const { m } = useI18n();
  const t = m.reorderSettings;
  const f = m.reorder.fields;
  const [values, setValues] = useState<Record<SupplierField, string>>(
    () => Object.fromEntries(SUPPLIER_FIELDS.map((k) => [k, toText(supplier[k])])) as Record<SupplierField, string>,
  );
  const placeholder: Record<SupplierField, string> = {
    leadTimeDays: '',
    safetyDays: String(defaults.safetyDays),
    targetDays: String(defaults.targetDays),
    minOrderQty: '0',
    orderMultiple: '1',
  };

  function save(e: React.FormEvent) {
    e.preventDefault();
    run(() =>
      request(`/api/store/suppliers/${supplier.id}`, 'PATCH', {
        leadTimeDays: Number(values.leadTimeDays),
        safetyDays: toNumber(values.safetyDays),
        targetDays: toNumber(values.targetDays),
        minOrderQty: toNumber(values.minOrderQty),
        orderMultiple: toNumber(values.orderMultiple),
      }),
    );
  }

  return (
    <li className="rounded-lg border border-border p-3">
      <form onSubmit={save} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">
            {supplier.name} <span className="text-xs font-normal text-muted-foreground">· {format(t.itemCount, { count: supplier.skuCount })}</span>
          </span>
          {isAdmin && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={`${t.remove} ${supplier.name}`}
              disabled={busy}
              onClick={() => {
                if (window.confirm(format(t.removeConfirm, { name: supplier.name }))) run(() => request(`/api/store/suppliers/${supplier.id}`, 'DELETE'));
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {SUPPLIER_FIELDS.map((key) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`supplier-${supplier.id}-${key}`} className="text-xs">
                {f[key]}
              </Label>
              <Input
                id={`supplier-${supplier.id}-${key}`}
                type="number"
                inputMode="numeric"
                required={key === 'leadTimeDays'}
                min={key === 'targetDays' || key === 'orderMultiple' ? 1 : 0}
                max={key === 'leadTimeDays' ? 60 : undefined}
                disabled={!isAdmin}
                placeholder={placeholder[key]}
                value={values[key]}
                onChange={(e) => setValues((p) => ({ ...p, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        {isAdmin && (
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="outline" disabled={busy}>
              {t.save}
            </Button>
          </div>
        )}
      </form>
    </li>
  );
}
