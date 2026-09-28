'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { CoverageBar, CoverageStatusBadge, habitInsights, remainingText, remainingUnitsText, SOURCE_LABEL } from '@/components/segment-dashboards/coverage-parts';
import type { StoreItemDetail } from '@/domain/segments/read-model';
import { describeUnits, INPUT_PRIOR_CYCLES } from '@/domain/segments/sales-coverage';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

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
                발주 단위 {unit} · {d.supplierName ? `${d.supplierName} ` : ''}리드타임 {d.leadTimeDays}일 · 기준일 {asOfDate}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-8">
              <section aria-label="현재 발주">
                <h3 className="text-sm font-semibold">지금 발주분</h3>
                {a.lastOrder ? (
                  <div className="mt-2 rounded-lg border border-border px-4 py-3">
                    <CoverageBar analysis={a} checkPct={d.checkRemainingPct} />
                    <p className="mt-1.5 text-xs text-muted-foreground">{remainingText(a)}</p>
                    <div className="mt-2 divide-y divide-border">
                      <Row
                        label="마지막 발주"
                        value={`${a.lastOrder.date} · ${a.lastOrder.quantity.toLocaleString('ko-KR')}${unit}`}
                        hint={
                          a.lastOrder.leftoverQuantity
                            ? `발주 당시 잔량 ${describeUnits(a.lastOrder.leftoverQuantity, unit)} 포함 ${describeUnits(a.openingUnits ?? 0, unit)}`
                            : undefined
                        }
                      />
                      <Row
                        label="지금 예상 잔량"
                        value={remainingUnitsText(a, unit) ?? '—'}
                        hint={a.salesPerUnit === null ? '충족 매출 비율로 어림한 값 · 재발주 때 실제 잔량을 적으면 정확해져요' : `학습된 ${unit}당 매출로 계산`}
                      />
                      <Row
                        label="충족 매출 기준"
                        value={a.estimate.amount === null ? '—' : formatCurrency(a.estimate.amount)}
                        hint={
                          a.estimate.source === 'blended'
                            ? `입력 ${formatCurrency(a.lastOrder.coverageAmount ?? 0)}와 학습값을 학습 ${Math.round(a.estimate.learnedWeight * 100)}% 비중으로 섞음`
                            : a.estimate.source === 'learned'
                              ? '입력값이 없어 학습값만 사용'
                              : a.estimate.source === 'entered'
                                ? '발주 때 입력한 값 (아직 학습 기록 없음)'
                                : undefined
                        }
                      />
                      <Row
                        label="발주 후 매출"
                        value={formatCurrency(a.consumedSales)}
                        hint={a.missingSalesDays > 0 ? `입력 ${formatCurrency(a.recordedSales)} + 미입력 ${a.missingSalesDays}일은 최근 평균으로 채움` : undefined}
                      />
                      <Row label="최근 하루 평균 매출" value={a.recentDailyAvg === null ? '—' : formatCurrency(a.recentDailyAvg)} />
                      <Row
                        label="확인 예상일"
                        value={a.status === 'ok' ? (a.expectedCheckDate ?? '—') : a.status === 'check_needed' || a.status === 'order_needed' ? '지금 확인하세요' : '—'}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">아직 발주 기록이 없어요.</p>
                )}
              </section>

              {habitInsights(a.habit, unit).length > 0 && (
                <section aria-label="재발주 습관" className="rounded-lg border border-brand-accent/30 bg-brand-accent/5 px-4 py-3">
                  <h3 className="text-sm font-semibold">지난 발주에서 배운 것</h3>
                  <ul className="mt-1.5 space-y-1 text-sm">
                    {habitInsights(a.habit, unit).map((line) => (
                      <li key={line} className="flex gap-2">
                        <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-brand-accent" />
                        {line}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    최근 발주 {a.cycles.slice(-6).length}회 기준 · 이 습관은 다음 발주의 충족 매출 학습값에 이미 반영돼 있어요.
                  </p>
                </section>
              )}

              <section aria-label="학습">
                <h3 className="text-sm font-semibold">입력할수록 정확해져요</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  같은 품목을 다시 발주하면, 직전 발주가 실제로 감당한 매출(두 발주 사이 매출)과 실제로 쓴 양(재발주 때 적은 잔량으로 계산)을 비교해 {unit}당 매출을 학습해요.
                  처음엔 입력값을 주로 쓰고, 학습 회차가 {INPUT_PRIOR_CYCLES}번을 넘어가면 학습값 비중이 더 커져요.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted/60 px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">학습된 {unit}당 매출</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums">{a.salesPerUnit === null ? '학습 전' : formatCurrency(a.salesPerUnit)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/60 px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">학습에 쓴 발주 회차</p>
                    <p className="mt-0.5 text-base font-semibold tabular-nums">{a.learnedCycles}회</p>
                  </div>
                </div>
                {a.cycles.length > 0 ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground">
                        <tr className="border-b border-border">
                          <th className="py-1.5 text-left font-medium">발주 → 다음 발주</th>
                          <th className="py-1.5 text-right font-medium">실제 감당 매출</th>
                          <th className="py-1.5 text-right font-medium">입력 대비</th>
                          <th className="py-1.5 text-right font-medium">재발주 때</th>
                          <th className="py-1.5 text-right font-medium">앱 예측 오차</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...a.cycles].reverse().map((c) => (
                          <tr key={c.orderDate} className="border-b border-border/60">
                            <td className="py-1.5">
                              {c.orderDate.slice(5)} → {c.nextOrderDate.slice(5)}
                              <span className="ml-1 text-muted-foreground">
                                {c.quantity.toLocaleString('ko-KR')}
                                {unit}·{c.days}일
                              </span>
                            </td>
                            <td className="py-1.5 text-right tabular-nums">{c.realizedSales === null ? '매출 기록 부족' : formatCurrency(c.realizedSales)}</td>
                            <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                              {c.overrunSales === null ? '—' : `${c.overrunSales >= 0 ? '+' : '−'}${formatCurrency(Math.abs(c.overrunSales))}`}
                              {c.daysAfterCross !== null && <span className="block text-[10px]">넘긴 뒤 {c.daysAfterCross}일</span>}
                            </td>
                            <td className="py-1.5 text-right text-muted-foreground">
                              {c.leftoverAtNext === null ? '잔량 미입력' : c.leftoverAtNext <= 0 ? '다 씀' : describeUnits(c.leftoverAtNext, unit)}
                            </td>
                            <td className={cn('py-1.5 text-right tabular-nums', c.systemError !== null && Math.abs(c.systemError) <= 0.1 && 'font-medium text-status-normal')}>
                              {pct(c.systemError)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      입력 대비 = 실제 감당 매출 − 입력한 충족 매출. 앱 예측 오차 = (그 당시 앱 예측 − 실제) ÷ 실제로, 0%에 가까울수록 정확해요.
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">이 품목을 한 번 더 발주하면 첫 학습 결과가 여기에 나타나요.</p>
                )}
              </section>

              <section aria-label="발주 기록">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">발주 기록</h3>
                  <Link href="/store/records" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                    발주 기록하기
                  </Link>
                </div>
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                  {d.orders.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">기록 없음</li>}
                  {d.orders.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="tabular-nums text-muted-foreground">{o.date}</span>
                      <span className="tabular-nums">
                        {o.quantity.toLocaleString('ko-KR')}
                        {unit}
                      </span>
                      <span className="ml-auto text-right text-xs text-muted-foreground">
                        {o.coverageAmount === null ? '충족 매출 미입력' : `충족 ${formatCurrency(o.coverageAmount)}`}
                        {o.leftoverQuantity !== null && <span className="block">당시 잔량 {o.leftoverQuantity <= 0 ? '없음' : describeUnits(o.leftoverQuantity, unit)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              {a.estimate.source !== 'none' && <p className="text-[11px] text-muted-foreground">현재 기준: {SOURCE_LABEL[a.estimate.source]}</p>}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
