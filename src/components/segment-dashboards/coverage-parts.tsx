'use client';

import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/components/i18n/i18n-provider';
import type { CoverageAnalysis, CoverageStatus, ReorderHabit } from '@/domain/segments/sales-coverage';
import { format } from '@/lib/i18n/locales';
import type { Messages } from '@/lib/i18n/messages';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

type StoreText = Messages['store'];

export const COVERAGE_VARIANT: Record<CoverageStatus, 'danger' | 'warning' | 'normal' | 'stagnant' | 'increase'> = {
  order_needed: 'danger',
  check_needed: 'warning',
  ok: 'normal',
  needs_coverage: 'increase',
  no_orders: 'stagnant',
  dormant: 'stagnant',
};

export function CoverageStatusBadge({ status }: { status: CoverageStatus }) {
  const { m } = useI18n();
  return <Badge variant={COVERAGE_VARIANT[status]}>{m.store.status[status]}</Badge>;
}

/** 충족 매출 대비 발주 후 누적 매출. 눈금은 '발주 확인 필요'가 시작되는 지점(설정의 발주 확인 기준). */
export function CoverageBar({ analysis, checkPct, className }: { analysis: CoverageAnalysis; checkPct: number; className?: string }) {
  const { m } = useI18n();
  if (analysis.progress === null) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.min(1, analysis.progress) * 100;
  const tone = analysis.status === 'order_needed' ? 'bg-status-danger' : analysis.status === 'check_needed' ? 'bg-status-warning' : 'bg-status-normal';
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="relative h-2 min-w-20 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(analysis.progress * 100)}
        aria-label={m.store.coverage.barAria}
      >
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
        <div className="absolute top-0 h-full w-px bg-foreground/40" style={{ left: `${100 - checkPct}%` }} aria-hidden="true" />
      </div>
      <span className="w-11 text-right text-xs tabular-nums text-muted-foreground">{Math.round(analysis.progress * 100)}%</span>
    </div>
  );
}

/** 남은 단위 수를 사람이 읽기 쉽게 — "2봉 + 마지막 봉의 약 40%". */
export function describeUnitsText(units: number, unit: string, t: StoreText): string {
  const whole = Math.floor(units + 1e-9);
  const pct = Math.round((units - whole) * 100);
  if (pct === 0) return format(t.units.whole, { whole, unit });
  if (whole === 0) return format(t.units.part, { pct, unit });
  return format(t.units.both, { whole, pct, unit });
}

/** 남은 매출 여유를 사람이 읽기 쉬운 문장으로. */
export function remainingText(a: CoverageAnalysis, t: StoreText, locale: string): string {
  const c = t.coverage;
  if (a.remainingSales === null) return a.status === 'needs_coverage' ? c.needsCoverage : '—';
  if (a.status === 'dormant') return format(c.dormant, { times: Math.floor(a.progress ?? 0) });
  if (a.remainingSales <= 0) return format(c.overrun, { amount: formatMoney(-a.remainingSales, locale) });
  const days = a.estimatedDaysLeft === null ? '' : a.estimatedDaysLeft < 1 ? c.today : format(c.days, { days: Math.round(a.estimatedDaysLeft) });
  return format(c.remaining, { amount: formatMoney(a.remainingSales, locale) }) + days;
}

/** 예상 잔량 — "2봉 + 마지막 봉의 약 40%". 학습 전에는 충족 매출 비율로 어림한 값이다. */
export function remainingUnitsText(a: CoverageAnalysis, unit: string, t: StoreText): string | null {
  if (a.estimatedRemainingUnits === null) return null;
  if (a.estimatedRemainingUnits <= 0.05) return t.coverage.almostOut;
  return describeUnitsText(Math.round(a.estimatedRemainingUnits * 20) / 20, unit, t);
}

/** 지난 발주에서 드러난 재발주 습관을 문장으로. 근거가 없는 항목은 빼고, 하나도 없으면 빈 배열. */
export function habitInsights(habit: ReorderHabit, unit: string, t: StoreText): string[] {
  const c = t.coverage;
  const lines: string[] = [];
  if (habit.avgOverrunRatio !== null) {
    const pct = Math.round(habit.avgOverrunRatio * 100);
    lines.push(Math.abs(pct) < 5 ? c.habitSame : pct > 0 ? format(c.habitMore, { pct }) : format(c.habitLess, { pct: -pct }));
  }
  if (habit.avgDaysAfterCross !== null) {
    const d = Math.round(habit.avgDaysAfterCross);
    lines.push(d <= 0 ? c.habitSameDay : format(c.habitDays, { days: d }));
  }
  if (habit.avgLeftoverAtReorder !== null) {
    lines.push(
      habit.avgLeftoverAtReorder <= 0.05 ? c.habitEmpty : format(c.habitLeftover, { units: describeUnitsText(Math.round(habit.avgLeftoverAtReorder * 20) / 20, unit, t) }),
    );
  }
  return lines;
}

/** 잔량 입력 선택지 — 열어 둔 마지막 단위가 얼마나 남았는지. */
export const OPEN_UNIT_OPTIONS = [
  { value: '0', key: 'none' },
  { value: '25', key: 'p25' },
  { value: '50', key: 'p50' },
  { value: '75', key: 'p75' },
] as const;
