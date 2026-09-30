'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import type { StoreItemExtras } from '@/domain/segments/read-model';
import { STORE_DEFAULT_EXPIRATION_RISK_DAYS } from '@/domain/segments/store-expiration';
import { formatMoney } from '@/lib/format';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? '');
}

interface Draft {
  unitCost: string;
  spec: string;
  storage: string;
  barcode: string;
  packSize: string;
  note: string;
  riskDays: string;
}

function toDraft(e: StoreItemExtras): Draft {
  return {
    unitCost: e.unitCost === null ? '' : String(e.unitCost),
    spec: e.spec,
    storage: e.storage,
    barcode: e.barcode,
    packSize: e.packSize === null ? '' : String(e.packSize),
    note: e.note,
    riskDays: e.expirationRiskDays === null ? '' : String(e.expirationRiskDays),
  };
}

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

/** 품목 줄 아래에 붙는 요약 — 원가. (소비기한은 발주마다 달라 발주 기록에서 입력한다.) */
export function StoreItemExtrasSummary({ extras, unit }: { extras: StoreItemExtras; unit: string }) {
  const { m, locale } = useI18n();
  const t = m.settingsScreens.items.extras;
  return extras.unitCost !== null ? <span>{` · ${format(t.summaryCost, { cost: `${formatMoney(extras.unitCost, locale)}/${unit}` })}`}</span> : null;
}

/**
 * 매장 품목의 원가·참고 정보 편집 패널. 재고 SKU와 같은 칸(원가, 옵션·위치·바코드·입수량, 메모)을 쓴다.
 * 소비기한은 발주분마다 달라 캘린더의 발주 입력에서 적고, 여기서는 임박으로 볼 일수만 정한다.
 */
export function StoreItemExtrasPanel({ itemName, unit, extras, isAdmin }: { itemName: string; unit: string; extras: StoreItemExtras; isAdmin: boolean }) {
  const { m } = useI18n();
  const t = m.settingsScreens.items.extras;
  const requestFailed = m.settingsScreens.common.requestFailed;
  const router = useRouter();
  const [draft, setDraft] = useState(() => toDraft(extras));
  const [busy, setBusy] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(toDraft(extras));
  const id = (field: string) => `extras-${extras.itemId}-${field}`;

  async function run(action: () => Promise<void>, success: string) {
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

  const field = (key: keyof Draft, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={id(key)} className="text-xs">
        {label}
      </Label>
      <Input id={id(key)} value={draft[key]} disabled={!isAdmin} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} {...props} />
    </div>
  );

  return (
    <div role="region" aria-label={format(t.aria, { name: itemName })} className="col-span-2 space-y-4 rounded-md bg-muted/50 p-3 sm:col-span-5">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () =>
              send(`/api/store/items/${extras.itemId}/extras`, 'PUT', {
                unitCost: numOrNull(draft.unitCost),
                spec: draft.spec,
                storage: draft.storage,
                barcode: draft.barcode,
                packSize: numOrNull(draft.packSize),
                note: draft.note,
                expirationRiskDays: numOrNull(draft.riskDays),
              }),
            t.saved,
          );
        }}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {field('unitCost', format(t.unitCost, { unit }), { type: 'number', inputMode: 'decimal', min: 0, step: 'any', className: 'text-right tabular-nums' })}
          {field('spec', t.spec, { maxLength: 50, placeholder: t.specPlaceholder })}
          {field('storage', t.storage, { maxLength: 30, placeholder: t.storagePlaceholder })}
          {field('barcode', t.barcode, { maxLength: 50, inputMode: 'numeric' })}
          {field('packSize', format(t.packSize, { unit }), { type: 'number', min: 1, step: 1, className: 'text-right tabular-nums' })}
          {field('riskDays', t.riskDays, {
            type: 'number',
            min: 0,
            max: 365,
            step: 1,
            placeholder: format(t.riskPlaceholder, { days: STORE_DEFAULT_EXPIRATION_RISK_DAYS }),
            className: 'text-right tabular-nums',
          })}
          <div className="col-span-2 sm:col-span-3">{field('note', t.note, { maxLength: 200, placeholder: t.notePlaceholder })}</div>
        </div>
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {t.expByOrder}
          <InfoTooltip>{t.expTip}</InfoTooltip>
        </p>
        {isAdmin ? (
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="outline" disabled={busy || !changed}>
              {t.save}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t.readOnly}</p>
        )}
      </form>

    </div>
  );
}
