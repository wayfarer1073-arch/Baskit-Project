import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

/** 비정기 실사: 마지막 실사 이후 이 일수가 지나면 다시 세어보길 권한다. */
export const DEFAULT_RECOUNT_DAYS = 14;
/** 소진 속도는 기준일로부터 이 기간 안의 실사 구간만으로 계산한다(오래된 판매 패턴 배제). */
export const USAGE_LOOKBACK_DAYS = 120;

export interface CountObservation {
  date: string; // yyyy-MM-dd
  quantity: number;
}

export interface DatedQuantity {
  date: string;
  quantity: number;
}

export type PeriodicStatus = 'estimated_out' | 'soon' | 'ok' | 'unknown';
export type EstimateConfidence = 'high' | 'medium' | 'low' | 'none';

export interface PeriodicEstimate {
  lastCountDate: string;
  lastCountQuantity: number;
  daysSinceCount: number;
  /** 소진 속도 계산에 쓴 실사 구간 수(입고로 설명되지 않는 증가가 있던 구간은 제외). */
  usableIntervals: number;
  dailyUsage: number | null;
  inboundSinceCount: number;
  /** 마지막 실사 + 이후 입고 − 추정 소진. 0 아래로는 내려가지 않는다. */
  estimatedStock: number | null;
  daysUntilStockout: number | null;
  estimatedStockoutDate: string | null;
  status: PeriodicStatus;
  confidence: EstimateConfidence;
  recountReasons: string[];
}

export interface PeriodicOptions {
  stockoutSoonDays: number;
  recountDays?: number;
}

/**
 * 재고를 매일 세지 않는(실사가 드문드문한) 경우의 현재 재고 추정.
 *
 * 실사 사이 구간마다 소진량 = 이전 실사 + 그 사이 기록된 입고 − 이번 실사로 보고, 기록되지 않은
 * 입고 때문에 재고가 늘어난 구간은 소진을 알 수 없으므로 계산에서 뺀다. 입고는 (이전 실사일, 이번
 * 실사일] 구간에 엄격하게 붙인다 — 매일 업로드 방식의 "다음 영업일 관용"은 실사 간격이 긴 이 방식에는
 * 맞지 않아 쓰지 않는다. 마지막 실사 다음 날부터 기준일까지의 입고는 현재 추정 재고에 더한다.
 */
export function estimatePeriodicStock(
  counts: CountObservation[],
  inbounds: DatedQuantity[],
  asOfDate: string,
  options: PeriodicOptions,
): PeriodicEstimate | null {
  const recountDays = options.recountDays ?? DEFAULT_RECOUNT_DAYS;
  const sorted = counts.filter((c) => c.date <= asOfDate).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return null;

  const last = sorted[sorted.length - 1];
  const lookbackStart = format(addDays(parseISO(asOfDate), -USAGE_LOOKBACK_DAYS), 'yyyy-MM-dd');
  const inboundBetween = (from: string, to: string) =>
    inbounds.filter((e) => e.date > from && e.date <= to).reduce((sum, e) => sum + e.quantity, 0);

  let depletionTotal = 0;
  let daysTotal = 0;
  let usableIntervals = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev.date < lookbackStart) continue;
    const days = differenceInCalendarDays(parseISO(curr.date), parseISO(prev.date));
    if (days <= 0) continue;
    const depletion = prev.quantity + inboundBetween(prev.date, curr.date) - curr.quantity;
    if (depletion < 0) continue;
    depletionTotal += depletion;
    daysTotal += days;
    usableIntervals += 1;
  }

  const dailyUsage = daysTotal > 0 ? depletionTotal / daysTotal : null;
  const daysSinceCount = differenceInCalendarDays(parseISO(asOfDate), parseISO(last.date));
  const inboundSinceCount = inboundBetween(last.date, asOfDate);

  let estimatedStock: number | null = null;
  let daysUntilStockout: number | null = null;
  let estimatedStockoutDate: string | null = null;
  if (dailyUsage !== null) {
    estimatedStock = Math.max(0, last.quantity + inboundSinceCount - dailyUsage * daysSinceCount);
    if (dailyUsage > 0) {
      daysUntilStockout = estimatedStock / dailyUsage;
      estimatedStockoutDate = format(addDays(parseISO(asOfDate), Math.floor(daysUntilStockout)), 'yyyy-MM-dd');
    }
  }

  let status: PeriodicStatus;
  if (dailyUsage === null) status = 'unknown';
  else if (estimatedStock !== null && estimatedStock <= 0) status = 'estimated_out';
  else if (daysUntilStockout !== null && daysUntilStockout <= options.stockoutSoonDays) status = 'soon';
  else status = 'ok';

  let confidence: EstimateConfidence;
  if (dailyUsage === null) confidence = 'none';
  else if (usableIntervals >= 3 && daysSinceCount <= recountDays) confidence = 'high';
  else if (usableIntervals >= 2 && daysSinceCount <= recountDays * 2) confidence = 'medium';
  else confidence = 'low';

  const recountReasons: string[] = [];
  if (daysSinceCount >= recountDays) recountReasons.push(`마지막 실사 후 ${daysSinceCount}일 경과`);
  if (status === 'estimated_out' || status === 'soon') recountReasons.push('추정상 품절 임박 — 발주 전 실제 수량 확인');
  if (dailyUsage === null) recountReasons.push('소진 속도를 알려면 실사가 한 번 더 필요');

  return {
    lastCountDate: last.date,
    lastCountQuantity: last.quantity,
    daysSinceCount,
    usableIntervals,
    dailyUsage,
    inboundSinceCount,
    estimatedStock,
    daysUntilStockout,
    estimatedStockoutDate,
    status,
    confidence,
    recountReasons,
  };
}

const STATUS_RANK: Record<PeriodicStatus, number> = { estimated_out: 0, soon: 1, unknown: 2, ok: 3 };

/** 실사 권장 목록 정렬 — 추정 품절 → 임박 → 판단 불가 → 여유 순, 같은 상태면 오래 안 센 순. */
export function compareRecountUrgency(a: PeriodicEstimate, b: PeriodicEstimate): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.daysSinceCount - a.daysSinceCount;
}
