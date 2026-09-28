import { Badge } from '@/components/ui/badge';
import { describeUnits, type CoverageAnalysis, type CoverageSource, type CoverageStatus, type ReorderHabit } from '@/domain/segments/sales-coverage';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

export const COVERAGE_STATUS: Record<CoverageStatus, { label: string; variant: 'danger' | 'warning' | 'normal' | 'stagnant' | 'increase' }> = {
  order_needed: { label: '발주 필요', variant: 'danger' },
  check_needed: { label: '발주 확인 필요', variant: 'warning' },
  ok: { label: '여유', variant: 'normal' },
  needs_coverage: { label: '충족 매출 입력 필요', variant: 'increase' },
  no_orders: { label: '발주 기록 없음', variant: 'stagnant' },
  dormant: { label: '장기 미발주', variant: 'stagnant' },
};

export const SOURCE_LABEL: Record<CoverageSource, string> = { entered: '입력값', learned: '학습값', blended: '입력+학습', none: '—' };

export function CoverageStatusBadge({ status }: { status: CoverageStatus }) {
  return <Badge variant={COVERAGE_STATUS[status].variant}>{COVERAGE_STATUS[status].label}</Badge>;
}

/** 충족 매출 대비 발주 후 누적 매출. 눈금은 '발주 확인 필요'가 시작되는 지점(설정의 발주 확인 기준). */
export function CoverageBar({ analysis, checkPct, className }: { analysis: CoverageAnalysis; checkPct: number; className?: string }) {
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
        aria-label="충족 매출 대비 발주 후 매출"
      >
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
        <div className="absolute top-0 h-full w-px bg-foreground/40" style={{ left: `${100 - checkPct}%` }} aria-hidden="true" />
      </div>
      <span className="w-11 text-right text-xs tabular-nums text-muted-foreground">{Math.round(analysis.progress * 100)}%</span>
    </div>
  );
}

/** 남은 매출 여유를 사람이 읽기 쉬운 문장으로. */
export function remainingText(a: CoverageAnalysis): string {
  if (a.remainingSales === null) return a.status === 'needs_coverage' ? '충족 매출을 입력하면 계산돼요' : '—';
  if (a.status === 'dormant') return `충족 매출의 ${Math.floor(a.progress ?? 0)}배 넘게 팔리는 동안 발주 기록이 없어요 · 안 쓰는 품목이면 설정에서 보관하세요`;
  if (a.remainingSales <= 0) return `충족 매출보다 ${formatCurrency(-a.remainingSales)} 더 팔렸어요`;
  const days = a.estimatedDaysLeft === null ? '' : a.estimatedDaysLeft < 1 ? ' · 오늘 중 소진 예상' : ` · 약 ${Math.round(a.estimatedDaysLeft)}일`;
  return `남은 여유 ${formatCurrency(a.remainingSales)}${days}`;
}

/** 예상 잔량 — "2봉 + 마지막 봉의 약 40%". 학습 전에는 충족 매출 비율로 어림한 값이다. */
export function remainingUnitsText(a: CoverageAnalysis, unit: string): string | null {
  if (a.estimatedRemainingUnits === null) return null;
  if (a.estimatedRemainingUnits <= 0.05) return '거의 다 썼을 거예요';
  return describeUnits(Math.round(a.estimatedRemainingUnits * 20) / 20, unit);
}

/** 지난 발주에서 드러난 재발주 습관을 문장으로. 근거가 없는 항목은 빼고, 하나도 없으면 빈 배열. */
export function habitInsights(habit: ReorderHabit, unit: string): string[] {
  const lines: string[] = [];
  if (habit.avgOverrunRatio !== null) {
    const pct = Math.round(habit.avgOverrunRatio * 100);
    lines.push(
      Math.abs(pct) < 5
        ? '입력한 충족 매출과 실제로 감당한 매출이 거의 같아요.'
        : pct > 0
          ? `실제로는 입력한 충족 매출보다 평균 ${pct}% 더 팔고 나서 재발주했어요.`
          : `입력한 충족 매출보다 평균 ${-pct}% 덜 팔았을 때 재발주했어요.`,
    );
  }
  if (habit.avgDaysAfterCross !== null) {
    const d = Math.round(habit.avgDaysAfterCross);
    lines.push(d <= 0 ? '충족 매출에 닿은 날 바로 재발주했어요.' : `충족 매출을 넘긴 뒤 평균 ${d}일 더 버티다 재발주했어요.`);
  }
  if (habit.avgLeftoverAtReorder !== null) {
    lines.push(
      habit.avgLeftoverAtReorder <= 0.05
        ? '재발주할 때는 보통 다 쓴 상태였어요.'
        : `재발주할 때 보통 ${describeUnits(Math.round(habit.avgLeftoverAtReorder * 20) / 20, unit)} 정도 남아 있었어요.`,
    );
  }
  return lines;
}

/** 잔량 입력 선택지 — 열어 둔 마지막 단위가 얼마나 남았는지. */
export const OPEN_UNIT_OPTIONS = [
  { value: '0', label: '없음' },
  { value: '25', label: '약 25%' },
  { value: '50', label: '약 50%' },
  { value: '75', label: '약 75%' },
] as const;
