'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionPanel } from '@/components/segment-dashboards/dashboard-parts';
import { OPEN_UNIT_OPTIONS, describeUnitsText } from '@/components/segment-dashboards/coverage-parts';
import type { OrderEntryRow, StoreItemLearning } from '@/domain/segments/read-model';
import { formatMoney } from '@/lib/format';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

type ItemSummary = StoreItemLearning;


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


export type Run = (action: () => Promise<unknown>, success: string) => Promise<boolean>;

/** 저장 요청을 보내고 알림·새로고침까지 하는 공용 실행기 — 기록 화면과 캘린더 패널이 함께 쓴다. */
export function useStoreRunner(): { busy: boolean; run: Run } {
  const requestFailed = useI18n().m.store.records.requestFailed;
  const router = useRouter();
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

interface DraftLine {
  key: number;
  itemId: string;
  quantity: string;
  coverage: string;
  /** 지금 남은 양 — 뜯지 않은 단위 수와, 열어 둔 마지막 단위가 남은 정도(%). 둘 다 비우면 '모름'. */
  leftWhole: string;
  leftOpen: string;
}

const won = (v: string) => Number(v.replace(/[^0-9]/g, ''));
let lineSeq = 0;
/** 첫 줄은 서버 렌더와 같은 key(0)를 쓰고, 이후 줄은 클라이언트에서만 번호를 늘린다(하이드레이션 불일치 방지). */
const newLine = (itemId: string, key = ++lineSeq): DraftLine => ({ key, itemId, quantity: '', coverage: '', leftWhole: '', leftOpen: '0' });

function leftoverOf(line: DraftLine): number | null {
  if (!line.leftWhole.trim() && line.leftOpen === '0') return null;
  return Math.max(0, Math.floor(Number(line.leftWhole) || 0)) + Number(line.leftOpen) / 100;
}

/** 앱이 예상한 잔량을 입력 칸 값으로 — 0.25 단위로 반올림. */
function leftoverDraft(units: number): Pick<DraftLine, 'leftWhole' | 'leftOpen'> {
  const q = Math.round(units * 4) / 4;
  const whole = Math.floor(q);
  return {
    leftWhole: String(whole),
    leftOpen: String(Math.round((q - whole) * 100)),
  };
}

/** 발주 기록. 캘린더 패널에서는 fixedDate로 날짜를 고정하고, 목록도 그날 발주만 보여준다. */
export function OrderSection({
  today,
  items,
  orders,
  busy,
  run,
  fixedDate,
}: {
  today: string;
  items: ItemSummary[];
  orders: OrderEntryRow[];
  busy: boolean;
  run: Run;
  fixedDate?: string;
}) {
  const { m, locale } = useI18n();
  const t = m.store.records;
  const [date, setDate] = useState(fixedDate ?? today);
  const [lines, setLines] = useState<DraftLine[]>([newLine(items[0]?.id ?? '', 0)]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const shownOrders = fixedDate ? orders.filter((o) => o.date === fixedDate) : orders;

  function update(key: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /** 이 품목을 (잔량 + 이 수량)만큼 갖게 됐을 때 과거 기록상 감당했던 매출(학습값). */
  function suggestion(line: DraftLine) {
    const item = byId.get(line.itemId);
    const q = Number(line.quantity);
    if (!item || item.salesPerUnit === null || !(q > 0)) return null;
    const units = q + (leftoverOf(line) ?? 0);
    return {
      amount: Math.round((item.salesPerUnit * units) / 1000) * 1000,
      cycles: item.learnedCycles,
      withLeftover: units !== q,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = lines
      .filter((l) => l.itemId && Number(l.quantity) > 0)
      .map((l) => ({
        itemId: l.itemId,
        quantity: Number(l.quantity),
        coverageAmount: l.coverage.trim() ? won(l.coverage) : null,
        leftoverQuantity: leftoverOf(l),
      }));
    const ok = await run(() => send('/api/store/orders', 'POST', { date, lines: payload }), format(t.ordersSaved, { count: payload.length }));
    if (ok) setLines([newLine(items[0]?.id ?? '')]);
  }

  return (
    <SectionPanel
      title={t.orderTitle}
      description={t.orderDescription}
    >
      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          {t.noItemsBefore}
          <Link href="/settings?tab=store" className="font-medium text-foreground underline underline-offset-4">
            {t.noItemsLink}
          </Link>
          {t.noItemsAfter}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3 border-b border-border px-5 py-4">
          {!fixedDate && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="order-date">{t.orderDate}</Label>
                <Input id="order-date" type="date" max={today} required value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
              </div>
            </div>
          )}
          <div className="space-y-2">
            {lines.map((line, index) => {
              const item = byId.get(line.itemId);
              const hint = suggestion(line);
              return (
                <div key={line.key} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1.2fr_0.6fr_1.2fr_1fr_auto] sm:items-end">
                  <div className="col-span-2 space-y-1 sm:col-span-1">
                    <Label htmlFor={`order-item-${line.key}`} className="text-xs">
                      {format(t.item, { index: index + 1 })}
                    </Label>
                    <Select
                      value={line.itemId}
                      onValueChange={(v) =>
                        update(line.key, {
                          itemId: v,
                          leftWhole: '',
                          leftOpen: '0',
                        })
                      }
                    >
                      <SelectTrigger id={`order-item-${line.key}`} className="w-full">
                        <SelectValue placeholder={t.pickItem} />
                      </SelectTrigger>
                      <SelectContent>
                        {items.map((i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`order-qty-${line.key}`} className="text-xs">
                      {t.quantity}
                      {item && ` (${item.unit})`}
                    </Label>
                    <Input
                      id={`order-qty-${line.key}`}
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="any"
                      required
                      value={line.quantity}
                      onChange={(e) => update(line.key, { quantity: e.target.value })}
                    />
                  </div>
                  <fieldset className="col-span-2 space-y-1 sm:col-span-1">
                    <legend className="mb-1 text-xs font-medium">{t.leftNow}</legend>
                    <div className="flex gap-1.5">
                      <Input
                        id={`order-left-${line.key}`}
                        aria-label={format(t.unopenedAria, { unit: item?.unit ?? t.unitFallback })}
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        placeholder={t.unknown}
                        value={line.leftWhole}
                        onChange={(e) => update(line.key, { leftWhole: e.target.value })}
                        className="w-20"
                      />
                      <span className="self-center text-xs text-muted-foreground">{item?.unit}</span>
                      <Select value={line.leftOpen} onValueChange={(v) => update(line.key, { leftOpen: v })}>
                        <SelectTrigger aria-label={format(t.openAria, { unit: item?.unit ?? t.unitFallback })} className="min-w-0 flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OPEN_UNIT_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.value === '0' ? t.noneOpen : format(t.lastOpen, { unit: item?.unit ?? '', label: m.store.open[o.key] })}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </fieldset>
                  <div className="space-y-1">
                    <Label htmlFor={`order-cov-${line.key}`} className="text-xs">
                      {t.coverageAmount}
                    </Label>
                    <Input
                      id={`order-cov-${line.key}`}
                      inputMode="numeric"
                      pattern="[0-9,]*"
                      placeholder={hint ? hint.amount.toLocaleString() : t.coveragePlaceholder}
                      value={line.coverage}
                      onChange={(e) => update(line.key, { coverage: e.target.value })}
                      required={!hint}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 justify-self-end"
                    disabled={lines.length === 1}
                    onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                    aria-label={format(t.deleteLine, { index: index + 1 })}
                  >
                    <X className="size-4" />
                  </Button>
                  <div className="col-span-2 space-y-0.5 text-[11px] text-muted-foreground sm:col-span-5">
                    {item && item.estimatedRemainingUnits !== null && (
                      <p>
                        {t.appEstimate}
                        <strong className="text-foreground">
                          {item.estimatedRemainingUnits <= 0.05 ? t.almostNone : describeUnitsText(Math.round(item.estimatedRemainingUnits * 4) / 4, item.unit, m.store)}
                        </strong>{' '}
                        <button type="button" className="underline underline-offset-2" onClick={() => update(line.key, leftoverDraft(item.estimatedRemainingUnits ?? 0))}>
                          {t.useThis}
                        </button>
                        <span className="ml-1">{t.countHelp}</span>
                      </p>
                    )}
                    <p>
                      {hint ? (
                        <>
                          {hint.withLeftover ? t.learnedWithLeftover : t.learnedQuantity}
                          <strong className="text-foreground">{formatMoney(hint.amount, locale)}</strong>
                          {format(t.learnedAfter, { count: hint.cycles })}
                          <button
                            type="button"
                            className="underline underline-offset-2"
                            onClick={() =>
                              update(line.key, {
                                coverage: hint.amount.toLocaleString(),
                              })
                            }
                          >
                            {t.useThis}
                          </button>
                        </>
                      ) : item && item.orderCount > 0 ? (
                        t.notLearned
                      ) : (
                        t.firstOrder
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, newLine(items[0]?.id ?? '')])}>
              <Plus className="size-3.5" />
              {t.addItem}
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {t.submit}
            </Button>
          </div>
        </form>
      )}
      <ul className="max-h-80 divide-y divide-border overflow-y-auto">
        {shownOrders.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted-foreground">{t.noOrders}</li>}
        {shownOrders.map((o) => (
          <li key={o.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
            <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{o.date}</span>
            <span className="min-w-0 flex-1 truncate">{o.itemName}</span>
            <span className="tabular-nums">
              {o.quantity.toLocaleString()}
              {o.unit}
            </span>
            <span className="hidden w-40 text-right text-xs text-muted-foreground sm:inline">
              {o.coverageAmount === null ? t.coverageLearned : format(t.coverageValue, { amount: formatMoney(o.coverageAmount, locale) })}
              {o.leftoverQuantity !== null && <span className="block">{format(t.leftoverThen, { units: o.leftoverQuantity <= 0 ? t.none : describeUnitsText(o.leftoverQuantity, o.unit, m.store) })}</span>}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              disabled={busy}
              aria-label={format(t.deleteOrderAria, { date: o.date, item: o.itemName })}
              onClick={() => confirm(t.deleteOrderConfirm) && run(() => send(`/api/store/orders/${o.id}`, 'DELETE'), t.deleted)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </SectionPanel>
  );
}
