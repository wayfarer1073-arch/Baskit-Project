import { parseISO } from 'date-fns';
import { buildDailyDeltas } from './calculations';
import { demandDaysBetween, isDemandDay, latestShippingDay, NO_HOLIDAYS, shiftDate, type ClosedDays } from './shipping-calendar';
import type { SkuAnalysis, StockObservation } from './types';

/**
 * 미업로드일 재고 추정(nowcast).
 *
 * 그날 재고 파일이 올라오지 않으면 마지막으로 올라온 재고에서 그 뒤 수요일(평일, 휴무 포함)마다 빠졌을 양을 빼서
 * 오늘 재고를 추정한다. 하루 소진량은 품목별 시계열 모델로 예측한다.
 *
 *  1. 재고 변화를 수요일 하루 단위 소진량 시계열로 펼친다(여러 날에 걸친 구간은 고르게 나누고, 입고 기록 없이 재고가
 *     늘어난 구간은 소진량을 알 수 없어 비워 둔다).
 *  2. 후보 모델 — 지수평활(α 0.1·0.2·0.3·0.5), 요일 계수를 곱한 지수평활(4주 이상 자료가 있을 때), 최근 10·20일 평균.
 *  3. 마지막 70 수요일 안에서 시점을 하나씩 옮겨 가며(rolling origin) 1~5일 뒤 누적 소진량을 실제와 비교하는 백테스트로
 *     오차(WAPE)가 가장 작은 모델을 고른다.
 *  4. 그 모델로 경과일 동안의 소진량을 빼고, 백테스트 오차의 80% 분위로 범위를 낸다.
 *
 * 추정은 자료가 끊기기 전 신뢰도가 '상'이고, 백테스트 오차가 작으며, 공백이 길지 않은 품목에만 한다. 나머지는 '예측 불가'.
 */

export const NOWCAST_MAX_GAP_DEMAND_DAYS = 10;
export const NOWCAST_MAX_WAPE = 0.3;
export const NOWCAST_MIN_ORIGINS = 6;
const HISTORY_DEMAND_DAYS = 70;
const BACKTEST_HORIZON = 5;
const BACKTEST_ORIGINS = 15;
const MIN_TRAIN = 10;
const WEEKDAY_MIN_VALUES = 20;
const WEEKDAY_SHRINK = 2;
const INTERVAL_QUANTILE = 0.8;

export type NowcastUnavailableReason =
  | 'sold_out' // 품절 표시 품목
  | 'special' // 특수 관리(B2B) — 개별 판단
  | 'low_reliability' // 끊기기 전 신뢰도가 '상'이 아님
  | 'gap_too_long' // 자료 공백이 너무 김
  | 'insufficient_history' // 백테스트할 자료가 모자람
  | 'unstable_pattern' // 소진 흐름이 불규칙해 백테스트 오차가 큼
  | 'no_depletion'; // 최근 소진이 관측되지 않음

export type NowcastMethod = 'ewma' | 'ewma_weekday' | 'mean';

export interface NowcastBacktest {
  /** 비교한 시점 수. */
  origins: number;
  /** 누적 소진량 기준 가중 절대 백분율 오차(0.12 = 12%). */
  wape: number;
}

export interface Nowcast {
  status: 'estimated' | 'unavailable';
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
  method: NowcastMethod | null;
  /** 모델 설명용(지수평활 α, 평균 기간). */
  parameter: number | null;
  backtest: NowcastBacktest | null;
  reason: NowcastUnavailableReason | null;
  /** low_reliability일 때 자료가 끊기기 전의 추정 불가 사유(있으면). */
  detail: string | null;
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
    for (const date of days) series.push({ date, weekday: parseISO(date).getDay(), value });
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
  /** horizon(1..H)별 누적 소진량 절대 오차들. */
  errorsByHorizon: number[][];
}

/** 끝에서부터 최대 BACKTEST_ORIGINS개 시점에서 1~H일 뒤 누적 소진량을 예측해 실제와 비교한다. */
function backtest(spec: ModelSpec, series: DemandDay[]): BacktestResult | null {
  let absError = 0;
  let actualTotal = 0;
  let origins = 0;
  const errorsByHorizon: number[][] = Array.from({ length: BACKTEST_HORIZON }, () => []);
  for (let origin = series.length - 1; origin >= MIN_TRAIN && origins < BACKTEST_ORIGINS; origin--) {
    // origin = 학습 자료 길이. 다음 H일이 모두 관측된 시점만 쓴다.
    const future = series.slice(origin, origin + BACKTEST_HORIZON);
    if (future.length < BACKTEST_HORIZON || future.some((d) => d.value === null)) continue;
    const predicted = forecast(
      spec,
      series.slice(0, origin),
      future.map((d) => d.weekday),
    );
    if (!predicted) continue;
    let cumPred = 0;
    let cumActual = 0;
    for (let h = 0; h < BACKTEST_HORIZON; h++) {
      cumPred += predicted[h];
      cumActual += future[h].value!;
      const error = Math.abs(cumPred - cumActual);
      absError += error;
      actualTotal += cumActual;
      errorsByHorizon[h].push(error);
    }
    origins++;
  }
  if (origins === 0 || actualTotal <= 0) return null;
  return { spec, origins, wape: absError / actualTotal, errorsByHorizon };
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 가장 오차가 작은 모델. 동률이면 단순한 모델(목록 앞쪽)을 쓴다. */
export function selectModel(series: DemandDay[]): BacktestResult | null {
  let best: BacktestResult | null = null;
  for (const spec of MODELS) {
    const result = backtest(spec, series);
    if (result && (!best || result.wape < best.wape - 1e-9)) best = result;
  }
  return best;
}

// ── 추정 ─────────────────────────────────────────────────────────────────────────────────────

export interface NowcastInput {
  observations: StockObservation[];
  asOfDate: string;
  holidays?: ClosedDays;
  isB2B?: boolean;
  isSoldOut?: boolean;
  /** 마지막 관측일 기준으로 다시 분석한 결과(자료가 끊기기 전 신뢰도). */
  preGapAnalysis: SkuAnalysis;
}

const daysApart = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function nowcastStock(input: NowcastInput): Nowcast {
  const holidays = input.holidays ?? NO_HOLIDAYS;
  const latest = input.preGapAnalysis.latest;
  // 기준일에 아직 출고가 끝나지 않은 휴무일 주문은 빼고, 마지막 출고일까지 쌓인 수요일만 센다.
  const horizonDays = demandDaysBetween(latest.date, latestShippingDay(input.asOfDate, holidays), holidays);
  const base: Nowcast = {
    status: 'unavailable',
    lastObservedDate: latest.date,
    lastObservedStock: latest.normalStock,
    elapsedDays: daysApart(latest.date, input.asOfDate),
    horizonDays,
    estimatedStock: null,
    low: null,
    high: null,
    expectedDepletion: null,
    method: null,
    parameter: null,
    backtest: null,
    reason: null,
    detail: null,
  };
  const unavailable = (reason: NowcastUnavailableReason, extra: Partial<Nowcast> = {}): Nowcast => ({ ...base, ...extra, reason });

  if (input.isSoldOut) return unavailable('sold_out');
  if (input.isB2B) return unavailable('special');
  const pre = input.preGapAnalysis;
  if (pre.operating?.reason === '소진 미관측') return unavailable('no_depletion');
  if (pre.reliability?.level !== 'HIGH' || pre.operating?.reason) return unavailable('low_reliability', { detail: pre.operating?.reason ?? null });
  if (horizonDays > NOWCAST_MAX_GAP_DEMAND_DAYS) return unavailable('gap_too_long');

  const sorted = input.observations.filter((o) => o.date <= latest.date).sort((a, b) => a.date.localeCompare(b.date));
  const series = demandDaySeries(sorted, holidays);
  const best = selectModel(series);
  if (!best || best.origins < NOWCAST_MIN_ORIGINS) {
    return unavailable('insufficient_history', best ? { backtest: { origins: best.origins, wape: best.wape } } : {});
  }
  const backtestSummary = { origins: best.origins, wape: best.wape };
  if (best.wape > NOWCAST_MAX_WAPE) return unavailable('unstable_pattern', { method: best.spec.method, parameter: best.spec.parameter, backtest: backtestSummary });

  const futureWeekdays: number[] = [];
  for (let day = shiftDate(latest.date, 1); futureWeekdays.length < horizonDays; day = shiftDate(day, 1)) {
    if (isDemandDay(day, holidays)) futureWeekdays.push(parseISO(day).getDay());
  }
  const predicted = forecast(best.spec, series, futureWeekdays) ?? [];
  const expectedDepletion = predicted.reduce((s, v) => s + v, 0);
  // 범위: 해당 horizon의 백테스트 오차 80% 분위. 백테스트보다 먼 horizon은 √(h/H)로 넓힌다.
  const h = Math.max(1, horizonDays);
  const within = Math.min(h, BACKTEST_HORIZON);
  const spread = quantile(best.errorsByHorizon[within - 1], INTERVAL_QUANTILE) * Math.sqrt(h / within);
  const stock = latest.normalStock;
  const round = (v: number) => Math.round(Math.max(0, v));
  return {
    ...base,
    status: 'estimated',
    estimatedStock: round(stock - expectedDepletion),
    low: round(stock - expectedDepletion - spread),
    high: round(Math.min(stock, stock - expectedDepletion + spread)),
    expectedDepletion,
    method: best.spec.method,
    parameter: best.spec.parameter,
    backtest: backtestSummary,
  };
}
