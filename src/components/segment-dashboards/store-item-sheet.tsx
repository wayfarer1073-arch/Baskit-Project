'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { CoverageBar, CoverageStatusBadge, describeUnitsText, habitInsights, remainingText, remainingUnitsText } from '@/components/segment-dashboards/coverage-parts';
import type { StoreItemDetail } from '@/domain/segments/read-model';
import { INPUT_PRIOR_CYCLES } from '@/domain/segments/sales-coverage';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { Paged } from '@/components/ui/paged';

function pct(v: number | null) {
  if (v === null) return '—';
  const n = Math.round(v * 100);
  return `${n > 0 ? '+' : ''}${n}%`;
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm tabular-nums">
        {value}
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </div>
  );
}

export function StoreItemSheet({ itemId, asOfDate, onOpenChange }: { itemId: string | null; asOfDate: string; onOpenChange: (open: boolean) => void }) {
  const { m, locale } = useI18n();
  const t = m.store.item;
  const money = (v: number) => formatMoney(v, locale);
  const du = (units: number) => describeUnitsText(units, unit, m.store);
  const [detail, setDetail] = useState<StoreItemDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/store/items/${itemId}/detail?asOf=${asOfDate}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => !cancelled && setDetail(data))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [itemId, asOfDate]);

  const d = detail && detail.itemId === itemId ? detail : null;
  const a = d?.analysis;
  const unit = d?.unit ?? '';

  return (
    <Sheet open={!!itemId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[560px]">
        {loading && !d && (
          <div className="space-y-4 p-5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {d && a && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle>{d.name}</SheetTitle>
                <CoverageStatusBadge status={a.status} />
              </div>
              <SheetDescription>
                {format(t.subtitle, { unit, supplier: d.supplierName ? `${d.supplierName} ` : '', days: d.leadTimeDays, date: asOfDate })}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-8">
              <section aria-label={t.current}>
                <h3 className="text-sm font-semibold">{t.current}</h3>
                {a.lastOrder ? (
                  <div className="mt-2 rounded-lg border border-border px-4 py-3">
                    <CoverageBar analysis={a} checkPct={d.checkRemainingPct} />
                    <p className="mt-1.5 text-xs text-muted-foreground">{remainingText(a, m.store, locale)}</p>
                    <div className="mt-2 divide-y divide-border">
                      <Row
                        label={t.lastOrder}
                        value={`${a.lastOrder.date} · ${format(m.store.units.qty, { qty: a.lastOrder.quantity.toLocaleString(), unit })}`}
                        hint={
                          a.lastOrder.leftoverQuantity
                            ? format(t.openingHint, { leftover: du(a.lastOrder.leftoverQuantity), opening: du(a.openingUnits ?? 0) })
                            : undefined
                        }
                      />
                      <Row
                        label={t.leftNow}
                        value={remainingUnitsText(a, unit, m.store) ?? '—'}
                        hint={a.salesPerUnit === null ? t.leftRatio : format(t.leftLearned, { unit })}
                      />
                      <Row
                        label={t.coverage}
                        value={a.estimate.amount === null ? '—' : money(a.estimate.amount)}
                        hint={
                          a.estimate.source === 'blended'
                            ? format(t.blended, { amount: money(a.lastOrder.coverageAmount ?? 0), pct: Math.round(a.estimate.learnedWeight * 100) })
                            : a.estimate.source === 'learned'
                              ? t.learnedOnly
                              : a.estimate.source === 'entered'
                                ? t.enteredOnly
                                : undefined
                        }
                      />
                      <Row
                        label={t.sales}
                        value={money(a.consumedSales)}
                        hint={a.missingSalesDays > 0 ? format(t.missing, { amount: money(a.recordedSales), days: a.missingSalesDays }) : undefined}
                      />
                      <Row label={t.dailyAvg} value={a.recentDailyAvg === null ? '—' : money(a.recentDailyAvg)} />
                      <Row
                        label={t.checkDate}
                        value={a.status === 'ok' ? (a.expectedCheckDate ?? '—') : a.status === 'check_needed' || a.status === 'order_needed' ? t.checkNow : '—'}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">{t.noOrders}</p>
                )}
              </section>

              {habitInsights(a.habit, unit, m.store).length > 0 && (
                <section aria-label={t.habitAria} className="rounded-lg border border-brand-accent/30 bg-brand-accent/5 px-4 py-3">
                  <h3 className="text-sm font-semibold">{t.habitTitle}</h3>
                  <ul className="mt-1.5 space-y-1 text-sm">
                    {habitInsights(a.habit, unit, m.store).map((line) => (
                      <li key={line} className="flex gap-2">
                        <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-brand-accent" />
                        {line}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {format(t.habitFooter, { count: a.cycles.slice(-6).length })}
                  </p>
                </section>
              )}

              <section aria-label={t.learnTitle}>
                <h3 className="text-sm font-semibold">{t.learnTitle}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {format(t.learnBody, { unit, cycles: INPUT_PRIOR_CYCLES })}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted/60 px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">{format(t.perUnit, { unit })}</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums">{a.salesPerUnit === null ? t.notLearned : money(a.salesPerUnit)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/60 px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">{t.cycles}</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums">{format(t.cyclesValue, { count: a.learnedCycles })}</p>
                  </div>
                </div>
                {a.cycles.length > 0 ? (
                  <div className="mt-3 overflow-x-auto">
                    <Paged items={[...a.cycles].reverse()}>
                      {(pageItems) => (
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground">
                          <tr className="border-b border-border">
                            <th className="py-1.5 text-left font-medium">{t.colCycle}</th>
                            <th className="py-1.5 text-right font-medium">{t.colRealized}</th>
                            <th className="py-1.5 text-right font-medium">{t.colOverrun}</th>
                            <th className="py-1.5 text-right font-medium">{t.colLeftover}</th>
                            <th className="py-1.5 text-right font-medium">{t.colError}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageItems.map((c) => (
                            <tr key={c.orderDate} className="border-b border-border/60">
                              <td className="py-1.5">
                                {c.orderDate.slice(5)} → {c.nextOrderDate.slice(5)}
                                <span className="ml-1 text-muted-foreground">
                                  {format(m.store.units.qty, { qty: c.quantity.toLocaleString(), unit })}·{format(t.cycleDays, { days: c.days })}
                                </span>
                              </td>
                              <td className="py-1.5 text-right tabular-nums">{c.realizedSales === null ? t.notEnoughSales : money(c.realizedSales)}</td>
                              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                                {c.overrunSales === null ? '—' : `${c.overrunSales >= 0 ? '+' : '−'}${money(Math.abs(c.overrunSales))}`}
                                {c.daysAfterCross !== null && <span className="block text-[10px]">{format(t.daysAfter, { days: c.daysAfterCross })}</span>}
                              </td>
                              <td className="py-1.5 text-right text-muted-foreground">
                                {c.leftoverAtNext === null ? t.leftoverMissing : c.leftoverAtNext <= 0 ? t.usedUp : du(c.leftoverAtNext)}
                              </td>
                              <td className={cn('py-1.5 text-right tabular-nums', c.systemError !== null && Math.abs(c.systemError) <= 0.1 && 'font-medium text-status-normal')}>
                                {pct(c.systemError)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      )}
                    </Paged>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      {t.tableHelp}
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">{t.firstLearning}</p>
                )}
              </section>

              <section aria-label={t.orders}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t.orders}</h3>
                  <Link href="/store/records" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                    {t.recordOrder}
                  </Link>
                </div>
                <Paged items={d.orders}>
                  {(pageItems) => (
                    <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                      {d.orders.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">{t.noRecords}</li>}
                      {pageItems.map((o) => (
                        <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="tabular-nums text-muted-foreground">{o.date}</span>
                          <span className="tabular-nums">
                            {format(m.store.units.qty, { qty: o.quantity.toLocaleString(), unit })}
                          </span>
                          <span className="ml-auto text-right text-xs text-muted-foreground">
                            {o.coverageAmount === null ? t.coverageMissing : format(m.store.records.coverageValue, { amount: money(o.coverageAmount) })}
                            {o.leftoverQuantity !== null && <span className="block">{format(m.store.records.leftoverThen, { units: o.leftoverQuantity <= 0 ? m.store.records.none : du(o.leftoverQuantity) })}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Paged>
              </section>
              {a.estimate.source !== 'none' && <p className="text-[11px] text-muted-foreground">{format(t.currentBasis, { source: m.store.source[a.estimate.source] })}</p>}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
