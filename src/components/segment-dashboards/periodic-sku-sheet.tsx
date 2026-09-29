'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { STATUS_VARIANT, recountReasonText } from '@/components/segment-dashboards/periodic-parts';
import type { PeriodicSkuDetail } from '@/domain/segments/read-model';
import { formatMoney, formatNumber } from '@/lib/format';
import { ReliabilityInfo } from '@/components/ui/reliability-info';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

function Row({ label, value, hint, info }: { label: string; value: React.ReactNode; hint?: string; info?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {info}
      </span>
      <span className="text-right text-sm tabular-nums">
        {value}
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </div>
  );
}

/** 실사 수량 추이 — 막대 높이만으로 늘고 준 흐름을 보여주는 작은 막대(최근 12회). */
function CountBars({ counts }: { counts: PeriodicSkuDetail['counts'] }) {
  const t = useI18n().m.periodic.sheet;
  const recent = [...counts].slice(0, 12).reverse();
  const max = Math.max(1, ...recent.map((c) => c.quantity));
  return (
    <div className="flex h-20 items-end gap-1" role="img" aria-label={format(t.barsAria, { count: recent.length, list: recent.map((c) => `${c.date} ${c.quantity}`).join(', ') })}>
      {recent.map((c) => (
        <div key={c.date} className="group relative flex flex-1 flex-col items-center justify-end" title={`${c.date} · ${formatNumber(c.quantity)}`}>
          <div
            className="w-full max-w-6 rounded-t-[4px] bg-brand-accent/70 transition-colors group-hover:bg-brand-accent"
            style={{ height: `${Math.max(3, (c.quantity / max) * 72)}px` }}
          />
        </div>
      ))}
    </div>
  );
}

export function PeriodicSkuSheet({ skuId, asOfDate, onOpenChange }: { skuId: string | null; asOfDate: string; onOpenChange: (open: boolean) => void }) {
  const { m, locale } = useI18n();
  const t = m.periodic.sheet;
  const [detail, setDetail] = useState<PeriodicSkuDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!skuId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/periodic/skus/${skuId}?asOf=${asOfDate}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => !cancelled && setDetail(data))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [skuId, asOfDate]);

  const d = detail && detail.skuId === skuId ? detail : null;
  const e = d?.estimate;

  return (
    <Sheet open={!!skuId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[520px]">
        {loading && !d && (
          <div className="space-y-4 p-5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {d && e && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle>{d.productName}</SheetTitle>
                <Badge variant={STATUS_VARIANT[e.status]}>{m.periodic.status[e.status]}</Badge>
              </div>
              <SheetDescription>
                {format(t.subtitle, { code: d.productCode, warehouse: d.warehouseName, date: asOfDate })}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-8">
              <section aria-label={t.estimateAria} className="rounded-lg border border-border px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">{t.estimateNow}</span>
                  <span className="text-2xl font-semibold tabular-nums">{e.estimatedStock === null ? '—' : formatNumber(Math.round(e.estimatedStock))}</span>
                </div>
                <div className="mt-2 divide-y divide-border">
                  <Row
                    label={t.lastCount}
                    value={`${e.lastCountDate} · ${formatNumber(e.lastCountQuantity)}`}
                    hint={e.daysSinceCount === 0 ? t.countedToday : format(t.daysAgo, { days: e.daysSinceCount })}
                  />
                  <Row label={t.inbound} value={e.inboundSinceCount ? `+${formatNumber(e.inboundSinceCount)}` : '—'} />
                  <Row
                    label={t.dailyUsage}
                    value={e.dailyUsage === null ? '—' : e.dailyUsage.toFixed(1)}
                    hint={e.dailyUsage === null ? t.usageUnknown : format(t.usageBasis, { count: e.usableIntervals })}
                  />
                  <Row label={t.stockout} value={e.estimatedStockoutDate ?? '—'} hint={e.status === 'soon' ? format(t.stockoutSoon, { days: d.stockoutSoonDays }) : undefined} />
                  <Row
                    label={t.confidence}
                    value={e.reliability ? `${m.periodic.confidence[e.confidence]} · ${format(t.score, { score: e.reliability.score })}` : m.periodic.confidence[e.confidence]}
                    hint={format(t.confidenceBasis, { days: d.recountDays })}
                    info={<ReliabilityInfo reliability={e.reliability} />}
                  />
                  {d.unitCost !== null && e.estimatedStock !== null && (
                    <Row label={t.value} value={formatMoney(Math.round(e.estimatedStock * d.unitCost), locale)} hint={format(t.unitCost, { cost: formatMoney(d.unitCost, locale) })} />
                  )}
                </div>
                {e.recountReasons.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {e.recountReasons.map((reason) => (
                      <span key={reason} className="rounded-md bg-status-warning-bg px-2 py-0.5 text-[11px] text-status-warning">
                        {recountReasonText(reason, m.periodic.reasons)}
                      </span>
                    ))}
                    <Link href="/count" className="ml-auto text-xs font-medium underline underline-offset-4">
                      {t.countNow}
                    </Link>
                  </div>
                )}
              </section>

              <section aria-label={t.history}>
                <h3 className="text-sm font-semibold">{t.history}</h3>
                {d.counts.length > 1 && (
                  <div className="mt-3">
                    <CountBars counts={d.counts} />
                  </div>
                )}
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                  {d.counts.map((c) => (
                    <li key={c.date} className="px-3 py-2 text-sm">
                      <div className="flex items-center gap-3">
                        <span className="tabular-nums text-muted-foreground">{c.date}</span>
                        <span className="text-[11px] text-muted-foreground">{c.manual ? t.manual : t.excel}</span>
                        <span className="ml-auto font-medium tabular-nums">{formatNumber(c.quantity)}</span>
                      </div>
                      {c.lots.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {c.lots.map((l) => (
                            <span key={l.lot} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                              {l.lot} · {formatNumber(l.quantity)}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              {d.inbounds.length > 0 && (
                <section aria-label={t.inbounds}>
                  <h3 className="text-sm font-semibold">{t.inbounds}</h3>
                  <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                    {d.inbounds.slice(0, 20).map((i, idx) => (
                      <li key={`${i.date}-${idx}`} className="flex justify-between px-3 py-2 text-sm">
                        <span className="tabular-nums text-muted-foreground">{i.date}</span>
                        <span className="tabular-nums">+{formatNumber(i.quantity)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
