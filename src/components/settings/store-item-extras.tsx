'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import type { StoreItemExtras } from '@/domain/segments/read-model';
import { DEFAULT_EXPIRATION_RISK_DAYS } from '@/domain/inventory/types';
import { daysUntilDate, isExpirationNear } from '@/lib/expiration-days';
import { formatMoney } from '@/lib/format';
import { formatExpirationDday } from '@/lib/status';
import { cn } from '@/lib/utils';
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

/** 품목 줄 아래에 붙는 요약 — 원가와 가장 이른 소비기한. */
export function StoreItemExtrasSummary({ extras, unit }: { extras: StoreItemExtras; unit: string }) {
  const { m, locale } = useI18n();
  const t = m.settingsScreens.items.extras;
  const soonest = extras.lots[0];
  return (
    <>
      {extras.unitCost !== null && <span>{` · ${format(t.summaryCost, { cost: `${formatMoney(extras.unitCost, locale)}/${unit}` })}`}</span>}
      {soonest && (
        <span className={cn(isExpirationNear(soonest.expirationDate, extras.expirationRiskDays) && 'font-medium text-destructive')}>
          {` · ${format(t.summaryExp, { date: `${soonest.expirationDate} ${formatExpirationDday(daysUntilDate(soonest.expirationDate))}` })}`}
        </span>
      )}
    </>
  );
}

/**
 * 매장 품목의 원가·소비기한·참고 정보 편집 패널. 재고 SKU와 같은 칸(원가, 소비기한 로트, 옵션·위치·바코드·입수량, 메모)을 쓴다.
 * 소비기한 로트는 추가·삭제가 바로 저장되고, 나머지는 '정보 저장'으로 한 번에 저장한다.
 */
export function StoreItemExtrasPanel({ itemName, unit, extras, isAdmin }: { itemName: string; unit: string; extras: StoreItemExtras; isAdmin: boolean }) {
  const { m } = useI18n();
  const t = m.settingsScreens.items.extras;
  const requestFailed = m.settingsScreens.common.requestFailed;
  const router = useRouter();
  const [draft, setDraft] = useState(() => toDraft(extras));
  const [lotDate, setLotDate] = useState('');
  const [lotName, setLotName] = useState('');
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
            placeholder: format(t.riskPlaceholder, { days: DEFAULT_EXPIRATION_RISK_DAYS }),
            className: 'text-right tabular-nums',
          })}
          <div className="col-span-2 sm:col-span-3">{field('note', t.note, { maxLength: 200, placeholder: t.notePlaceholder })}</div>
        </div>
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

      <section aria-label={t.expTitle} className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center gap-1.5">
          <h4 className="text-xs font-semibold">{t.expTitle}</h4>
          <InfoTooltip>{t.expTip}</InfoTooltip>
        </div>
        {extras.lots.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.expEmpty}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {extras.lots.map((l) => {
              const near = isExpirationNear(l.expirationDate, draft.riskDays === '' ? null : Number(draft.riskDays));
              return (
                <li
                  key={l.lotId}
                  className={cn('flex items-center gap-1.5 rounded-md border bg-background py-0.5 pr-0.5 pl-2 text-xs', near ? 'border-destructive/40' : 'border-border')}
                >
                  <span className="font-medium">{l.lot}</span>
                  <span className="tabular-nums">{l.expirationDate}</span>
                  <span className={cn('tabular-nums', near ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
                    {formatExpirationDday(daysUntilDate(l.expirationDate))}
                  </span>
                  {isAdmin && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      disabled={busy}
                      aria-label={format(t.deleteLotAria, { lot: l.lot })}
                      onClick={() => run(() => send(`/api/expiration/lots/${l.lotId}`, 'DELETE'), t.lotDeleted)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {isAdmin && (
          <form
            className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(() => send('/api/expiration/lots', 'POST', { skuId: extras.itemId, lot: lotName.trim() || null, expirationDate: lotDate }), t.lotAdded);
              if (ok) {
                setLotDate('');
                setLotName('');
              }
            }}
          >
            <div className="space-y-1">
              <Label htmlFor={id('lot-date')} className="text-xs">
                {t.expDate}
              </Label>
              <Input id={id('lot-date')} type="date" required value={lotDate} onChange={(e) => setLotDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={id('lot-name')} className="text-xs">
                {t.lotName}
              </Label>
              <Input id={id('lot-name')} maxLength={30} placeholder={t.lotPlaceholder} value={lotName} onChange={(e) => setLotName(e.target.value)} />
            </div>
            <Button type="submit" size="sm" disabled={busy || !lotDate} className="col-span-2 sm:col-span-1">
              <Plus className="size-4" />
              {t.addLot}
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
