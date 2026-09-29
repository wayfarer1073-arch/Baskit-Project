'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { formatNumber } from '@/lib/format';
import { formatKstDate } from '@/lib/date';
import { POLICY_KEYS, type PolicyKey, type PolicyLayer, type ReorderStatus, type ReorderSuggestion } from '@/domain/reorder/reorder';

export interface Turnover30 {
  ratio: number;
  depletion: number;
  averageStock: number;
}

const OVERRIDE_FIELD: Record<PolicyKey, 'reorderLeadTimeDays' | 'reorderSafetyDays' | 'reorderTargetDays' | 'reorderMinQty' | 'reorderMultiple'> = {
  leadTimeDays: 'reorderLeadTimeDays',
  safetyDays: 'reorderSafetyDays',
  targetDays: 'reorderTargetDays',
  minOrderQty: 'reorderMinQty',
  orderMultiple: 'reorderMultiple',
};

const NO_SUPPLIER = '__none__';

export function reorderStatusVariant(status: ReorderStatus): 'destructive' | 'warning' | 'secondary' | 'outline' {
  if (status === 'overdue' || status === 'today') return 'destructive';
  if (status === 'soon') return 'warning';
  if (status === 'later') return 'secondary';
  return 'outline';
}

/** 품목 상세의 발주 제안 — 권장 발주일·발주량과 그 계산에 쓴 기준(어느 층에서 왔는지), 품목 예외 편집. */
export function ReorderPanel({
  skuId,
  reorder,
  turnover30,
  supplierId,
  overrides,
  canEdit,
  onSaved,
}: {
  skuId: string;
  reorder: ReorderSuggestion | null | undefined;
  turnover30: Turnover30 | null | undefined;
  supplierId: string | null | undefined;
  overrides: PolicyLayer | undefined;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const { m } = useI18n();
  const t = m.reorder;
  const [editing, setEditing] = useState(false);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [supplier, setSupplier] = useState(supplierId ?? NO_SUPPLIER);
  const [values, setValues] = useState<Record<PolicyKey, string>>(() => toInputs(overrides));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) return;
    fetch('/api/suppliers')
      .then((res) => (res.ok ? res.json() : { suppliers: [] }))
      .then((body) => setSuppliers(body.suppliers ?? []))
      .catch(() => undefined);
  }, [editing]);

  function startEdit() {
    setSupplier(supplierId ?? NO_SUPPLIER);
    setValues(toInputs(overrides));
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    try {
      const body: Record<string, string | number | null> = { supplierId: supplier === NO_SUPPLIER ? null : supplier };
      for (const key of POLICY_KEYS) body[OVERRIDE_FIELD[key]] = values[key].trim() === '' ? null : Number(values[key]);
      const res = await fetch(`/api/sku/${skuId}/reorder`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error ?? t.failed);
      toast.success(t.saved);
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border bg-muted/30 p-3" aria-labelledby="reorder-title">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="reorder-title" className="text-xs font-semibold">
          {t.title}
        </h3>
        {reorder && <Badge variant={reorderStatusVariant(reorder.status)}>{t.status[reorder.status]}</Badge>}
      </div>

      {!reorder ? (
        <p className="text-xs text-muted-foreground">{t.none}</p>
      ) : reorder.status === 'not_needed' ? (
        <p className="text-xs text-muted-foreground">{t.notNeeded}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <Item label={t.orderDate} value={reorder.orderDate ? formatKstDate(reorder.orderDate) : '—'} />
          <Item label={t.quantity} value={formatNumber(reorder.quantity)} strong />
          <Item label={t.arrival} value={reorder.arrivalDate ? formatKstDate(reorder.arrivalDate) : '—'} />
          <Item label={t.stockAtArrival} value={formatNumber(reorder.stockAtArrival)} />
        </dl>
      )}

      {turnover30 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t.turnover}: {format(t.turnoverValue, { ratio: turnover30.ratio.toFixed(1), avg: formatNumber(Math.round(turnover30.averageStock)) })}
        </p>
      )}

      {reorder && !editing && (
        <div className="mt-3 border-t pt-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium">{t.policy}</span>
            {canEdit && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={startEdit}>
                {t.edit}
              </Button>
            )}
          </div>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            {POLICY_KEYS.map((key) => (
              <li key={key} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t.fields[key]}</span>
                <span className="tabular-nums">
                  {formatNumber(reorder.policy[key])} <span className="text-muted-foreground">· {t.sources[reorder.policy.sources[key]]}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-3 border-t pt-3">
          <div className="space-y-1">
            <Label className="text-xs">{t.supplier}</Label>
            <Select value={supplier} onValueChange={setSupplier}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SUPPLIER}>{t.noSupplier}</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">{t.inherit}</p>
          <div className="grid grid-cols-2 gap-2">
            {POLICY_KEYS.map((key) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`reorder-${key}`} className="text-xs">
                  {t.fields[key]}
                </Label>
                <Input
                  id={`reorder-${key}`}
                  type="number"
                  inputMode="numeric"
                  min={key === 'targetDays' || key === 'orderMultiple' ? 1 : 0}
                  step={1}
                  className="h-9"
                  placeholder={reorder ? String(reorder.policy[key]) : ''}
                  value={values[key]}
                  onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              {t.cancel}
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {t.save}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function toInputs(overrides: PolicyLayer | undefined): Record<PolicyKey, string> {
  return Object.fromEntries(POLICY_KEYS.map((key) => [key, overrides?.[key] === null || overrides?.[key] === undefined ? '' : String(overrides[key])])) as Record<
    PolicyKey,
    string
  >;
}

function Item({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</dd>
    </div>
  );
}
