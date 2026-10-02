import { buildDailyDeltas } from './calculations';
import { daysBetween, demandDaysBetween, isDemandDay, latestShippingDay, NO_HOLIDAYS, shiftDate, weekdayOf, type ClosedDays } from './shipping-calendar';
import type { StockObservation } from './types';

/**
 * 미업로드일 재고 추정(nowcast) — 일일 업로드 창고 전용.
 *
 * 그날 재고 파일이 올라오지 않으면 마지막으로 올라온 재고에서 그 뒤 수요일(평일, 휴무 포함)마다 빠졌을 양을 빼서
 * 오늘 재고를 추정한다. 하루 소진량은 품목별 시계열 모델로 예측한다.
 *
 *  1. 재고 변화를 수요일 하루 단위 소진량 시계열로 펼친다(여러 날에 걸친 구간은 고르게 나누고, 입고 기록 없이 재고가
 *     늘어난 구간은 소진량을 알 수 없어 그 구간만 비워 둔다 — 품목 전체를 막지 않는다).
 *  2. 후보 모델 — 지수평활(α 0.1·0.2·0.3·0.5), 요일 계수를 곱한 지수평활(4주 이상 자료가 있을 때), 최근 10·20일 평균.
 *  3. 실제 자료 공백과 같은 길이(H 수요일)로, 과거 시점을 하나씩 옮겨 가며(rolling origin) H일 누적 소진량을 예측해
 *     실제와 비교한다. 오차(WAPE)가 가장 작은 모델을 고르고, 그 오차로 추정 신뢰도 등급을 매긴다.
 *  4. 그 모델로 공백 동안의 소진량을 빼고, 같은 백테스트 오차의 80% 분위로 범위를 낸다.
 *
 * 자료 신뢰도 배지와는 무관하다 — 품목 자신의 과거 자료로 '이만큼 비어 있을 때 얼마나 맞았나'를 직접 재서 판단한다.
 *  - 상: 예상 오차 ≤ 15%, 중: ≤ 30%, 하: ≤ 50%(참고용), 그 이상은 예측 불가.
 *  - 최근 평일 20일 동안 소진이 없으면 '변동 없음'(직전 재고 그대로).
 *  - 품절·특수 관리 품목, 최근 30일 안에 음수 재고가 있던 품목, 소진량을 아는 날이 15일 미만인 품목은 추정하지 않는다.
 *  - 공백은 최대 평일 30일, 그리고 학습 자료 길이의 절반까지.
 */

export const NOWCAST_MAX_GAP_DEMAND_DAYS = 30;
export const NOWCAST_GRADE_LIMITS = { HIGH: 0.15, MEDIUM: 0.3, LOW: 0.5 } as const;
export const NOWCAST_MIN_KNOWN_DAYS = 15;
export const NOWCAST_MIN_ORIGINS = 5;
const FLAT_LOOKBACK_DAYS = 20;
const FLAT_MIN_KNOWN_DAYS = 10;
const HISTORY_DEMAND_DAYS = 70;
const BACKTEST_ORIGINS = 15;
const MIN_TRAIN = 10;
/** 백테스트 구간 중 소진량을 아는 날이 이 비율 이상인 시점만 비교한다. */
const MIN_KNOWN_FRACTION = 0.7;
const WEEKDAY_MIN_VALUES = 20;
const WEEKDAY_SHRINK = 2;
const INTERVAL_QUANTILE = 0.8;
const INTEGRITY_LOOKBACK_DAYS = 30;

export type NowcastUnavailableReason =
  | 'sold_out' // 품절 표시 품목
  | 'special' // 특수 관리(B2B) — 직전 재고를 그대로 보여 준다
  | 'integrity' // 최근 음수 재고 등 정합성 문제
  | 'gap_too_long' // 자료 공백이 너무 김
  | 'insufficient_history' // 학습·검증할 자료가 모자람
  | 'unstable_pattern'; // 소진 흐름이 불규칙해 같은 길이 백테스트 오차가 50% 초과

export type NowcastMethod = 'ewma' | 'ewma_weekday' | 'mean';
export type NowcastGrade = 'HIGH' | 'MEDIUM' | 'LOW';

export interface NowcastBacktest {
  /** 비교한 시점 수. */
  origins: number;
  /** 비교한 기간(수요일 수) — 실제 공백과 같다. */
  horizon: number;
  /** 누적 소진량 기준 가중 절대 백분율 오차(0.12 = 12%). */
  wape: number;
}

export interface Nowcast {
  /** estimated: 추정치, flat: 최근 소진이 없어 직전 재고 그대로, unavailable: 예측 불가. */
  status: 'estimated' | 'flat' | 'unavailable';
  lastObservedDate: string;
  lastObservedStock: number;
  /** 마지막 자료 이후 지난 달력 일수. */
  elapsedDays: number;
  /** 추정에 반영한 수요일 수(마지막 자료 다음 날 ~ 기준일까지 출고가 끝난 수요일). */
  horizonDays: number;
  estimatedStock: number | null;
  /** 80% 범위. */
  low: number | null;
  high: number | null;
  expectedDepletion: number | null;
  /** 추정 신뢰도(같은 길이 백테스트 오차 기준). estimated일 때만. */
  grade: NowcastGrade | null;
  method: NowcastMethod | null;
  /** 모델 설명용(지수평활 α, 평균 기간). */
  parameter: number | null;
  backtest: NowcastBacktest | null;
  reason: NowcastUnavailableReason | null;
}

// ── 시계열 ───────────────────────────────────────────────────────────────────────────────────

export interface DemandDay {
  date: string;
  /** 0=일 … 6=토. */
  weekday: number;
  /** 그날 소진량. 알 수 없으면 null. */
  value: number | null;
}

/** 관측(날짜 오름차순)을 마지막 관측일까지의 수요일 하루 소진량 시계열로 펼친다. */
export function demandDaySeries(sorted: StockObservation[], holidays: ClosedDays = NO_HOLIDAYS, maxDays = HISTORY_DEMAND_DAYS): DemandDay[] {
  const series: DemandDay[] = [];
  for (const d of buildDailyDeltas(sorted)) {
    const days: string[] = [];
    for (let day = shiftDate(d.fromDate, 1); day <= d.toDate; day = shiftDate(day, 1)) if (isDemandDay(day, holidays)) days.push(day);
    if (days.length === 0) continue;
    const value = d.increase > 0 ? null : d.depletion / days.length;
    for (const date of days) series.push({ date, weekday: weekdayOf(date), value });
  }
  return series.slice(-maxDays);
}

// ── 모델 ─────────────────────────────────────────────────────────────────────────────────────

interface ModelSpec {
  method: NowcastMethod;
  parameter: number;
}

const MODELS: ModelSpec[] = [
  ...[0.1, 0.2, 0.3, 0.5].map((alpha) => ({ method: 'ewma' as const, parameter: alpha })),
  ...[0.1, 0.2, 0.3].map((alpha) => ({ method: 'ewma_weekday' as const, parameter: alpha })),
  { method: 'mean', parameter: 10 },
  { method: 'mean', parameter: 20 },
];

/** 요일 계수 — 요일 평균 ÷ 전체 평균, 자료가 적은 요일은 1 쪽으로 당긴다. */
function weekdayFactors(history: DemandDay[]): number[] | null {
  const known = history.filter((d) => d.value !== null);
  if (known.length < WEEKDAY_MIN_VALUES) return null;
  const overall = known.reduce((s, d) => s + d.value!, 0) / known.length;
  if (overall <= 0) return null;
  const factors: number[] = [];
  for (let w = 0; w < 7; w++) {
    const same = known.filter((d) => d.weekday === w);
    if (same.length === 0) {
      factors.push(1);
      continue;
    }
    const raw = same.reduce((s, d) => s + d.value!, 0) / same.length / overall;
    const weight = same.length / (same.length + WEEKDAY_SHRINK);
    factors.push(weight * raw + (1 - weight));
  }
  return factors;
}

function ewmaLevel(values: number[], alpha: number): number {
  const start = values.slice(0, Math.min(5, values.length));
  let level = start.reduce((s, v) => s + v, 0) / start.length;
  for (const v of values) level = alpha * v + (1 - alpha) * level;
  return level;
}

/** history까지 보고 future 요일들의 하루 소진량을 예측한다. 예측할 수 없으면 null. */
function forecast(spec: ModelSpec, history: DemandDay[], futureWeekdays: number[]): number[] | null {
  const known = history.filter((d) => d.value !== null);
  if (known.length < 3) return null;
  if (spec.method === 'mean') {
    const recent = known.slice(-spec.parameter).map((d) => d.value!);
    const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
    return futureWeekdays.map(() => mean);
  }
  if (spec.method === 'ewma') {
    const level = ewmaLevel(
      known.map((d) => d.value!),
      spec.parameter,
    );
    return futureWeekdays.map(() => level);
  }
  const factors = weekdayFactors(history);
  if (!factors) return null;
  const level = ewmaLevel(
    known.map((d) => d.value! / factors[d.weekday]),
    spec.parameter,
  );
  return futureWeekdays.map((w) => level * factors[w]);
}

// ── 백테스트 ─────────────────────────────────────────────────────────────────────────────────

interface BacktestResult {
  spec: ModelSpec;
  origins: number;
  wape: number;
  /** 시점별 H일 누적 소진량 절대 오차(모르는 날 비율만큼 키워서 H일 전체 기준으로 맞춘 값). */
  errors: number[];
}

/** 끝에서부터 최대 BACKTEST_ORIGINS개 시점에서 H일 누적 소진량을 예측해 실제와 비교한다(소진량을 아는 날끼리만). */
function backtest(spec: ModelSpec, series: DemandDay[], horizon: number): BacktestResult | null {
  let absError = 0;
  let actualTotal = 0;
  let origins = 0;
  const errors: number[] = [];
  for (let origin = series.length - horizon; origin >= MIN_TRAIN && origins < BACKTEST_ORIGINS; origin--) {
    // origin = 학습 자료 길이. 다음 H일 중 소진량을 아는 날이 충분한 시점만 쓴다.
    const future = series.slice(origin, origin + horizon);
    const knownDays = future.filter((d) => d.value !== null).length;
    if (future.length < horizon || knownDays < Math.ceil(horizon * MIN_KNOWN_FRACTION)) continue;
    const predicted = forecast(
      spec,
      series.slice(0, origin),
      future.map((d) => d.weekday),
    );
    if (!predicted) continue;
    let cumPred = 0;
    let cumActual = 0;
    future.forEach((d, i) => {
      if (d.value === null) return;
      cumPred += predicted[i];
      cumActual += d.value;
    });
    const error = Math.abs(cumPred - cumActual);
    absError += error;
    actualTotal += cumActual;
    errors.push((error * horizon) / knownDays);
    origins++;
  }
  if (origins === 0 || actualTotal <= 0) return null;
  return { spec, origins, wape: absError / actualTotal, errors };
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 실제 공백과 같은 길이로 비교해 가장 오차가 작은 모델. 동률이면 단순한 모델(목록 앞쪽)을 쓴다. */
export function selectModel(series: DemandDay[], horizon: number): BacktestResult | null {
  let best: BacktestResult | null = null;
  for (const spec of MODELS) {
    const result = backtest(spec, series, horizon);
    if (result && (!best || result.wape < best.wape - 1e-9)) best = result;
  }
  return best;
}

export function gradeOf(wape: number): NowcastGrade | null {
  return wape <= NOWCAST_GRADE_LIMITS.HIGH ? 'HIGH' : wape <= NOWCAST_GRADE_LIMITS.MEDIUM ? 'MEDIUM' : wape <= NOWCAST_GRADE_LIMITS.LOW ? 'LOW' : null;
}

// ── 추정 ─────────────────────────────────────────────────────────────────────────────────────

export interface NowcastInput {
  observations: StockObservation[];
  asOfDate: string;
  holidays?: ClosedDays;
  isB2B?: boolean;
  isSoldOut?: boolean;
}

/** 기준일까지의 마지막 관측으로 오늘 재고를 추정한다. 기준일 이전 관측이 없으면 null. */
export function nowcastStock(input: NowcastInput): Nowcast | null {
  const holidays = input.holidays ?? NO_HOLIDAYS;
  const sorted = input.observations.filter((o) => o.date <= input.asOfDate).sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  if (!latest) return null;
  // 기준일에 아직 출고가 끝나지 않은 휴무일 주문은 빼고, 마지막 출고일까지 쌓인 수요일만 센다.
  const horizonDays = demandDaysBetween(latest.date, latestShippingDay(input.asOfDate, holidays), holidays);
  const base: Nowcast = {
    status: 'unavailable',
    lastObservedDate: latest.date,
    lastObservedStock: latest.normalStock,
    elapsedDays: daysBetween(latest.date, input.asOfDate),
    horizonDays,
    estimatedStock: null,
    low: null,
    high: null,
    expectedDepletion: null,
    grade: null,
    method: null,
    parameter: null,
    backtest: null,
    reason: null,
  };
  const unavailable = (reason: NowcastUnavailableReason, extra: Partial<Nowcast> = {}): Nowcast => ({ ...base, ...extra, reason });

  if (input.isSoldOut) return unavailable('sold_out');
  if (input.isB2B) return unavailable('special');
  const integrityFrom = shiftDate(latest.date, -INTEGRITY_LOOKBACK_DAYS);
  if (sorted.some((o) => o.date >= integrityFrom && o.normalStock < 0)) return unavailable('integrity');

  const series = demandDaySeries(sorted, holidays);
  const known = series.filter((d) => d.value !== null);
  // 최근 소진이 없으면 직전 재고가 그대로라고 본다.
  const recentKnown = series.slice(-FLAT_LOOKBACK_DAYS).filter((d) => d.value !== null);
  if (recentKnown.length >= FLAT_MIN_KNOWN_DAYS && recentKnown.every((d) => d.value === 0)) {
    return { ...base, status: 'flat', estimatedStock: latest.normalStock, low: latest.normalStock, high: latest.normalStock, expectedDepletion: 0 };
  }
  if (known.length < NOWCAST_MIN_KNOWN_DAYS) return unavailable('insufficient_history');
  const maxGap = Math.min(NOWCAST_MAX_GAP_DEMAND_DAYS, Math.floor(series.length / 2));
  if (horizonDays > maxGap) return unavailable('gap_too_long');

  const horizon = Math.max(1, horizonDays);
  const best = selectModel(series, horizon);
  if (!best || best.origins < NOWCAST_MIN_ORIGINS) {
    return unavailable('insufficient_history', best ? { backtest: { origins: best.origins, horizon, wape: best.wape } } : {});
  }
  const backtestSummary = { origins: best.origins, horizon, wape: best.wape };
  const grade = gradeOf(best.wape);
  if (!grade) return unavailable('unstable_pattern', { method: best.spec.method, parameter: best.spec.parameter, backtest: backtestSummary });

  const futureWeekdays: number[] = [];
  for (let day = shiftDate(latest.date, 1); futureWeekdays.length < horizonDays; day = shiftDate(day, 1)) {
    if (isDemandDay(day, holidays)) futureWeekdays.push(weekdayOf(day));
  }
  const predicted = forecast(best.spec, series, futureWeekdays) ?? [];
  const expectedDepletion = predicted.reduce((s, v) => s + v, 0);
  const spread = horizonDays === 0 ? 0 : quantile(best.errors, INTERVAL_QUANTILE);
  const stock = latest.normalStock;
  const round = (v: number) => Math.round(Math.max(0, v));
  return {
    ...base,
    status: 'estimated',
    estimatedStock: round(stock - expectedDepletion),
    low: round(stock - expectedDepletion - spread),
    high: round(Math.min(stock, stock - expectedDepletion + spread)),
    expectedDepletion,
    grade,
    method: best.spec.method,
    parameter: best.spec.parameter,
    backtest: backtestSummary,
  };
}
