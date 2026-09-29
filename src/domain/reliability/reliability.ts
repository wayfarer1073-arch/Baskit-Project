/**
 * 추정 신뢰도 — 세 가지 요인의 곱으로 0~100점을 매긴다.
 *
 *  1. 출처 가중치: 사람이 직접 센 실사(COUNT)가 가장 믿을 만하고, 시스템 재고 파일(SNAPSHOT)이 그다음이다.
 *  2. 관측 밀도: 소진 속도를 잰 기간 중 실제로 관측된 날의 비율 × 근거 기간이 얼마나 최근인지(짧을수록 최근).
 *  3. 경과 감쇠: 마지막 재고 확인 후 시간이 지날수록 반감기로 줄어든다(실사를 오래 안 하면 추정이 흐려진다).
 *
 * 추정 자체가 불가능한 사유(자료 갱신 필요·정합성 확인 등)가 있으면 점수와 관계없이 '하'다.
 */
export type ReliabilityLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type ReliabilitySource = 'COUNT' | 'SNAPSHOT';

export type ReliabilityNote =
  | { code: 'blocked'; reason: string }
  | { code: 'count_source' }
  | { code: 'snapshot_source' }
  | { code: 'sparse'; observed: number; expected: number }
  | { code: 'long_window'; windowDays: number }
  | { code: 'few_intervals'; intervals: number }
  | { code: 'aging'; days: number };

export interface Reliability {
  score: number;
  level: ReliabilityLevel;
  factors: { source: number; density: number; freshness: number };
  notes: ReliabilityNote[];
}

export interface ReliabilityInput {
  source: ReliabilitySource;
  /** 근거 기간 안에서 관측되었어야 할 날 수와 실제 관측된 날 수. */
  expectedDays: number;
  observedDays: number;
  /** 근거 기간 길이(일). 짧을수록 최근 흐름을 반영한다. null이면 기간 가중치를 적용하지 않는다. */
  windowDays: number | null;
  /** 속도 계산에 쓴 구간 수와, 충분하다고 보는 최소 구간 수. */
  intervals: number;
  minIntervals: number;
  /** 마지막 재고 확인 후 경과일과 반감기(일). */
  daysSinceLevel: number;
  halfLifeDays: number;
  /** 추정을 막는 사유. 있으면 무조건 '하'. */
  blockingReason: string | null;
}

export const SOURCE_WEIGHT: Record<ReliabilitySource, number> = { COUNT: 1, SNAPSHOT: 0.95 };
const WINDOW_WEIGHT: Record<number, number> = { 7: 1, 14: 0.8, 30: 0.5 };
export const HIGH_SCORE = 80;
export const MEDIUM_SCORE = 50;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function assessReliability(input: ReliabilityInput): Reliability {
  const notes: ReliabilityNote[] = [];
  const source = SOURCE_WEIGHT[input.source];
  notes.push({ code: input.source === 'COUNT' ? 'count_source' : 'snapshot_source' });

  const coverage = input.expectedDays > 0 ? clamp01(input.observedDays / input.expectedDays) : 0;
  const windowWeight = input.windowDays === null ? 1 : (WINDOW_WEIGHT[input.windowDays] ?? 0.5);
  const intervalWeight = input.minIntervals > 0 ? clamp01(input.intervals / input.minIntervals) : 1;
  const density = coverage * windowWeight * intervalWeight;
  if (coverage < 1 && input.expectedDays > 0) notes.push({ code: 'sparse', observed: input.observedDays, expected: input.expectedDays });
  if (input.windowDays !== null && windowWeight < 1) notes.push({ code: 'long_window', windowDays: input.windowDays });
  if (intervalWeight < 1) notes.push({ code: 'few_intervals', intervals: input.intervals });

  const freshness = input.halfLifeDays > 0 ? Math.pow(0.5, Math.max(0, input.daysSinceLevel) / input.halfLifeDays) : 1;
  if (freshness < 0.8) notes.push({ code: 'aging', days: input.daysSinceLevel });

  let score = Math.round(100 * source * density * freshness);
  let level: ReliabilityLevel = score >= HIGH_SCORE ? 'HIGH' : score >= MEDIUM_SCORE ? 'MEDIUM' : 'LOW';
  if (input.blockingReason) {
    notes.unshift({ code: 'blocked', reason: input.blockingReason });
    score = Math.min(score, MEDIUM_SCORE - 1);
    level = 'LOW';
  }
  return { score, level, factors: { source, density, freshness }, notes };
}
