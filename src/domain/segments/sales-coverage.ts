import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

/**
 * 매장 발주 확인 모델 — 재고를 세기 어려운 카페·음식점용.
 *
 * 발주할 때 "이 발주량으로 감당할 수 있는 매출액"(충족 매출)을 함께 입력하면, 이후 입력되는 일 매출이
 * 쌓이는 만큼 그 발주가 소진됐다고 본다. 남은 매출 여유가 기준 아래로 내려오면 '발주 확인 필요',
 * 다 쓰면 '발주 필요'로 알려준다.
 *
 * 같은 품목을 다시 발주하면 직전 발주가 실제로 감당한 매출(두 발주 사이의 매출)을 알 수 있다. 재발주할 때
 * 남은 양(잔량)도 적어 두면 그 사이 실제로 쓴 수량(= 이전 잔량 + 발주량 − 이번 잔량)까지 알 수 있어, 이를
 * 나눈 "단위당 매출"을 학습해 다음 발주의 충족 매출을 스스로 추정한다. 기록이 쌓일수록 사용자가 입력한
 * 값보다 학습값의 비중을 높인다 — 입력할수록 예측이 정확해지는 구조.
 */

/** 남은 매출 여유가 충족 매출의 이 비율 이하로 내려오면 '발주 확인 필요'(기본값, 설정에서 바꿀 수 있다). */
export const CHECK_REMAINING_RATIO = 0.2;
/** 학습값과 입력값을 섞을 때 입력값을 "이만큼의 발주 회차"로 쳐 준다. 학습 회차가 많아질수록 학습값 비중이 커진다. */
export const INPUT_PRIOR_CYCLES = 2;
/** 학습에 쓰는 최근 발주 회차 수 — 오래된 판매 패턴이 섞이지 않도록 제한한다. */
export const LEARNING_WINDOW_CYCLES = 6;
/** 발주 사이 기간 중 매출이 입력된 날이 이 비율 미만이면 그 회차는 학습에서 뺀다(빈 날이 너무 많아 신뢰할 수 없음). */
export const MIN_RECORDED_RATIO = 0.5;
/** 최근 하루 평균 매출을 볼 기간. */
export const RECENT_SALES_WINDOW_DAYS = 28;
export const MIN_SALES_DAYS = 7;
/** 충족 매출의 이 배수 넘게 팔렸는데도 재발주가 없으면, 더 쓰지 않는 품목으로 보고 체크리스트에서 뺀다. */
export const DORMANT_PROGRESS = 3;

export interface CoverageOrder {
  date: string; // yyyy-MM-dd
  quantity: number;
  /** 사용자가 입력한 충족 매출(원). 입력하지 않았으면 null — 학습값이 있으면 그것으로 추정한다. */
  coverageAmount: number | null;
  /** 이 발주를 넣을 때(받기 전) 남아 있던 양. 모르면 null(다 쓴 것으로 본다). */
  leftoverQuantity: number | null;
}

export interface SalesRecord {
  date: string;
  amount: number;
}

export type CoverageSource = 'entered' | 'learned' | 'blended' | 'none';
export type CoverageStatus = 'order_needed' | 'check_needed' | 'ok' | 'needs_coverage' | 'no_orders' | 'dormant';

export interface CoverageEstimate {
  amount: number | null;
  source: CoverageSource;
  /** 학습값에 준 가중치(0~1). 입력값만 쓰면 0, 학습값만 쓰면 1. */
  learnedWeight: number;
}

/** 다음 발주가 기록되어 끝난 발주 회차. 학습과 "예측이 얼마나 맞았는지" 표시에 쓴다. */
export interface CompletedCycle {
  orderDate: string;
  nextOrderDate: string;
  days: number;
  quantity: number;
  /** 이번 발주로 쓸 수 있던 양 = 발주 당시 잔량 + 발주량. */
  openingUnits: number;
  /** 다음 발주 때 남아 있던 양(입력한 경우). */
  leftoverAtNext: number | null;
  /** 이 기간에 실제로 쓴 양. 다음 발주 잔량을 모르면 전부 쓴 것으로 본다. */
  consumedUnits: number;
  enteredCoverage: number | null;
  /** 두 발주 사이 실제 매출(매출이 빠진 날은 그 회차 평균으로 채움). 입력일이 너무 적으면 null. */
  realizedSales: number | null;
  recordedDays: number;
  /** 그 발주 당시 시스템이 추정했던 충족 매출(그 이전 회차들만으로 계산). */
  systemEstimate: number | null;
  /** (추정 − 실제) / 실제. 양수면 과대 추정. */
  enteredError: number | null;
  systemError: number | null;
  /** 실제 매출 − 입력한 충족 매출. +면 입력보다 더 팔고 나서 재발주했다는 뜻. */
  overrunSales: number | null;
  /** 누적 매출이 입력한 충족 매출을 처음 넘은 날과, 그 뒤 재발주까지 걸린 일수. */
  crossedDate: string | null;
  daysAfterCross: number | null;
}

/** 지난 발주들에서 드러난 습관 — "보통 입력보다 N% 더 팔고, 넘긴 뒤 M일 뒤에, 잔량 L개일 때 발주". */
export interface ReorderHabit {
  cyclesWithEntry: number;
  avgOverrunRatio: number | null;
  avgDaysAfterCross: number | null;
  avgLeftoverAtReorder: number | null;
}

export interface CoverageAnalysis {
  lastOrder: CoverageOrder | null;
  estimate: CoverageEstimate;
  /** 지금 발주분으로 쓸 수 있던 양(잔량 + 발주량)과, 매출로 환산한 현재 예상 잔량. */
  openingUnits: number | null;
  estimatedRemainingUnits: number | null;
  habit: ReorderHabit;
  /** 학습에 쓸 수 있는 완료 회차 수와 단위당 매출. */
  learnedCycles: number;
  salesPerUnit: number | null;
  /** 마지막 발주일부터 기준일까지 매출(입력 안 된 지난 날은 최근 평균으로 채움). */
  consumedSales: number;
  recordedSales: number;
  missingSalesDays: number;
  remainingSales: number | null;
  progress: number | null;
  recentDailyAvg: number | null;
  estimatedDaysLeft: number | null;
  /** 이대로면 '발주 확인 필요'에 들어갈 날짜(이미 들어갔으면 null). */
  expectedCheckDate: string | null;
  status: CoverageStatus;
  cycles: CompletedCycle[];
}

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

function mergeSameDay(orders: CoverageOrder[]): CoverageOrder[] {
  const merged: CoverageOrder[] = [];
  for (const o of [...orders].sort((a, b) => a.date.localeCompare(b.date))) {
    if (o.quantity <= 0) continue;
    const prev = merged.at(-1);
    if (prev && prev.date === o.date) {
      prev.quantity += o.quantity;
      prev.coverageAmount = prev.coverageAmount === null && o.coverageAmount === null ? null : (prev.coverageAmount ?? 0) + (o.coverageAmount ?? 0);
      // 같은 날 나눠 넣은 발주의 잔량은 같은 재고를 가리키므로 먼저 적힌 값을 그대로 둔다.
      prev.leftoverQuantity = prev.leftoverQuantity ?? o.leftoverQuantity;
    } else merged.push({ ...o });
  }
  return merged;
}

function salesIn(sales: SalesRecord[], fromInclusive: string, toExclusive: string) {
  const inRange = sales.filter((s) => s.date >= fromInclusive && s.date < toExclusive);
  return { sum: inRange.reduce((s, r) => s + r.amount, 0), days: inRange.length, dates: new Set(inRange.map((r) => r.date)) };
}

export function recentDailyAverage(sales: SalesRecord[], asOfDate: string): number | null {
  const from = ymd(addDays(parseISO(asOfDate), -(RECENT_SALES_WINDOW_DAYS - 1)));
  const recent = sales.filter((s) => s.date >= from && s.date <= asOfDate);
  if (recent.length === 0) return null;
  return recent.reduce((s, r) => s + r.amount, 0) / recent.length;
}

function learnedRate(cycles: CompletedCycle[]): { rate: number | null; count: number } {
  const usable = cycles.filter((c) => c.realizedSales !== null && c.consumedUnits > 0).slice(-LEARNING_WINDOW_CYCLES);
  const units = usable.reduce((s, c) => s + c.consumedUnits, 0);
  if (usable.length === 0 || units <= 0) return { rate: null, count: 0 };
  return { rate: usable.reduce((s, c) => s + c.realizedSales!, 0) / units, count: usable.length };
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function summarizeHabit(cycles: CompletedCycle[]): ReorderHabit {
  const recent = cycles.slice(-LEARNING_WINDOW_CYCLES);
  const withEntry = recent.filter((c) => c.enteredCoverage !== null && c.realizedSales !== null);
  return {
    cyclesWithEntry: withEntry.length,
    avgOverrunRatio: average(withEntry.map((c) => c.realizedSales! / c.enteredCoverage! - 1)),
    avgDaysAfterCross: average(recent.filter((c) => c.daysAfterCross !== null).map((c) => c.daysAfterCross!)),
    avgLeftoverAtReorder: average(recent.filter((c) => c.leftoverAtNext !== null).map((c) => c.leftoverAtNext!)),
  };
}

/** 발주일부터 누적 매출(입력된 날만)이 기준 금액을 처음 넘은 날. */
function firstCrossingDate(sales: SalesRecord[], from: string, toExclusive: string, threshold: number): string | null {
  let sum = 0;
  for (const s of sales.filter((r) => r.date >= from && r.date < toExclusive).sort((a, b) => a.date.localeCompare(b.date))) {
    sum += s.amount;
    if (sum >= threshold) return s.date;
  }
  return null;
}

/** 입력값과 학습값을 섞는다. 학습 회차가 c번이면 학습값 가중치 = c / (c + INPUT_PRIOR_CYCLES). */
export function blendCoverage(entered: number | null, learnedAmount: number | null, learnedCount: number): CoverageEstimate {
  if (entered !== null && learnedAmount !== null) {
    const w = learnedCount / (learnedCount + INPUT_PRIOR_CYCLES);
    return { amount: w * learnedAmount + (1 - w) * entered, source: 'blended', learnedWeight: w };
  }
  if (entered !== null) return { amount: entered, source: 'entered', learnedWeight: 0 };
  if (learnedAmount !== null) return { amount: learnedAmount, source: 'learned', learnedWeight: 1 };
  return { amount: null, source: 'none', learnedWeight: 0 };
}

function relError(estimate: number | null, actual: number | null) {
  if (estimate === null || actual === null || actual <= 0) return null;
  return (estimate - actual) / actual;
}

export interface CoverageOptions {
  /** 남은 매출 여유가 충족 매출의 이 비율 이하이면 '발주 확인 필요'. 기본 0.2. */
  checkRemainingRatio?: number;
}

export function analyzeCoverage(orders: CoverageOrder[], sales: SalesRecord[], asOfDate: string, leadTimeDays: number, options: CoverageOptions = {}): CoverageAnalysis {
  const checkRatio = options.checkRemainingRatio ?? CHECK_REMAINING_RATIO;
  const merged = mergeSameDay(orders.filter((o) => o.date <= asOfDate));
  const salesToDate = sales.filter((s) => s.date <= asOfDate);

  const cycles: CompletedCycle[] = [];
  for (let i = 0; i < merged.length - 1; i++) {
    const o = merged[i];
    const next = merged[i + 1];
    const days = differenceInCalendarDays(parseISO(next.date), parseISO(o.date));
    const { sum, days: recordedDays } = salesIn(salesToDate, o.date, next.date);
    const realizedSales = days > 0 && recordedDays / days >= MIN_RECORDED_RATIO ? (sum * days) / recordedDays : null;
    const openingUnits = o.quantity + (o.leftoverQuantity ?? 0);
    const leftoverAtNext = next.leftoverQuantity;
    const consumedUnits = Math.max(0, openingUnits - (leftoverAtNext ?? 0));
    const prior = learnedRate(cycles);
    const systemEstimate = blendCoverage(o.coverageAmount, prior.rate === null ? null : prior.rate * openingUnits, prior.count).amount;
    const crossedDate = o.coverageAmount === null ? null : firstCrossingDate(salesToDate, o.date, next.date, o.coverageAmount);
    cycles.push({
      orderDate: o.date,
      nextOrderDate: next.date,
      days,
      quantity: o.quantity,
      openingUnits,
      leftoverAtNext,
      consumedUnits,
      enteredCoverage: o.coverageAmount,
      realizedSales,
      recordedDays,
      systemEstimate,
      enteredError: relError(o.coverageAmount, realizedSales),
      systemError: relError(systemEstimate, realizedSales),
      overrunSales: o.coverageAmount === null || realizedSales === null ? null : realizedSales - o.coverageAmount,
      crossedDate,
      daysAfterCross: crossedDate === null ? null : differenceInCalendarDays(parseISO(next.date), parseISO(crossedDate)),
    });
  }

  const last = merged.at(-1) ?? null;
  const learned = learnedRate(cycles);
  const recentAvg = recentDailyAverage(salesToDate, asOfDate);
  const habit = summarizeHabit(cycles);
  const empty: CoverageAnalysis = {
    lastOrder: null,
    estimate: { amount: null, source: 'none', learnedWeight: 0 },
    openingUnits: null,
    estimatedRemainingUnits: null,
    habit,
    learnedCycles: learned.count,
    salesPerUnit: learned.rate,
    consumedSales: 0,
    recordedSales: 0,
    missingSalesDays: 0,
    remainingSales: null,
    progress: null,
    recentDailyAvg: recentAvg,
    estimatedDaysLeft: null,
    expectedCheckDate: null,
    status: 'no_orders',
    cycles,
  };
  if (!last) return empty;

  const openingUnits = last.quantity + (last.leftoverQuantity ?? 0);
  const estimate = blendCoverage(last.coverageAmount, learned.rate === null ? null : learned.rate * openingUnits, learned.count);

  // 오늘 매출은 아직 입력 전일 수 있으므로 "빠진 날"은 어제까지만 센다.
  const tomorrow = ymd(addDays(parseISO(asOfDate), 1));
  const recorded = salesIn(salesToDate, last.date, tomorrow);
  let missingSalesDays = 0;
  for (let d = parseISO(last.date); ymd(d) < asOfDate; d = addDays(d, 1)) if (!recorded.dates.has(ymd(d))) missingSalesDays += 1;
  const consumedSales = recorded.sum + missingSalesDays * (recentAvg ?? 0);

  if (estimate.amount === null) {
    return { ...empty, lastOrder: last, estimate, openingUnits, consumedSales, recordedSales: recorded.sum, missingSalesDays, status: 'needs_coverage' };
  }

  const coverage = estimate.amount;
  const remainingSales = coverage - consumedSales;
  // 리드타임 동안 팔릴 매출만큼은 미리 여유를 둔다(도착 전에 떨어지지 않도록).
  const checkBuffer = Math.max(coverage * checkRatio, leadTimeDays * (recentAvg ?? 0));
  const status: CoverageStatus =
    coverage > 0 && consumedSales >= coverage * DORMANT_PROGRESS ? 'dormant' : remainingSales <= 0 ? 'order_needed' : remainingSales <= checkBuffer ? 'check_needed' : 'ok';
  const estimatedDaysLeft = recentAvg && recentAvg > 0 ? Math.max(0, remainingSales) / recentAvg : null;
  const expectedCheckDate = status === 'ok' && recentAvg && recentAvg > 0 ? ymd(addDays(parseISO(asOfDate), Math.ceil((remainingSales - checkBuffer) / recentAvg))) : null;

  // 남은 매출 여유를 수량으로 환산한다. 학습된 단위당 매출이 있으면 그것으로, 없으면 충족 매출 비율로 나눈다.
  const estimatedRemainingUnits =
    learned.rate !== null && learned.rate > 0
      ? Math.max(0, openingUnits - consumedSales / learned.rate)
      : coverage > 0
        ? Math.max(0, openingUnits * (1 - consumedSales / coverage))
        : null;

  return {
    lastOrder: last,
    estimate,
    openingUnits,
    estimatedRemainingUnits,
    habit,
    learnedCycles: learned.count,
    salesPerUnit: learned.rate,
    consumedSales,
    recordedSales: recorded.sum,
    missingSalesDays,
    remainingSales,
    progress: coverage > 0 ? consumedSales / coverage : null,
    recentDailyAvg: recentAvg,
    estimatedDaysLeft,
    expectedCheckDate,
    status,
    cycles,
  };
}

/** 발주 입력 화면용 — (잔량 + 발주량)이면 과거 기록상 얼마의 매출을 감당했는지(학습값). 기록이 없으면 null. */
export function suggestCoverage(orders: CoverageOrder[], sales: SalesRecord[], asOfDate: string, quantity: number, leftover = 0) {
  const a = analyzeCoverage(orders, sales, asOfDate, 0);
  if (a.salesPerUnit === null || quantity <= 0) return null;
  return { amount: a.salesPerUnit * (quantity + leftover), cycles: a.learnedCycles };
}

/** 2.4 → "2개 + 열린 1개 40%" 식으로 읽기 쉽게. */
export function describeUnits(units: number, unit: string): string {
  const whole = Math.floor(units + 1e-9);
  const pct = Math.round((units - whole) * 100);
  if (pct === 0) return `${whole}${unit}`;
  if (whole === 0) return `마지막 ${unit}의 약 ${pct}%`;
  return `${whole}${unit} + 마지막 ${unit}의 약 ${pct}%`;
}

const STATUS_RANK: Record<CoverageStatus, number> = { order_needed: 0, check_needed: 1, needs_coverage: 2, ok: 3, no_orders: 4, dormant: 5 };

export function compareCoverageUrgency(a: CoverageAnalysis, b: CoverageAnalysis): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || (b.progress ?? 0) - (a.progress ?? 0);
}

export interface SalesTrend {
  recentDailyAvg: number | null;
  previousDailyAvg: number | null;
  /** 최근 4주 vs 그 이전 4주 하루 평균 매출 증감률. 비교할 수 없으면 null. */
  growthRate: number | null;
  weekly: { weekStart: string; total: number; recordedDays: number }[];
}

function avgDailySales(sales: SalesRecord[], fromInclusive: string, toInclusive: string) {
  const inRange = sales.filter((s) => s.date >= fromInclusive && s.date <= toInclusive);
  if (inRange.length === 0) return null;
  return { avg: inRange.reduce((sum, s) => sum + s.amount, 0) / inRange.length, days: inRange.length };
}

/** 대시보드 요약용 매출 추세 — 최근 4주/직전 4주 비교와 주간(월요일 시작) 합계. */
export function summarizeSales(sales: SalesRecord[], asOfDate: string, weeks = 12): SalesTrend {
  const asOf = parseISO(asOfDate);
  const recentFrom = ymd(addDays(asOf, -(RECENT_SALES_WINDOW_DAYS - 1)));
  const prevTo = ymd(addDays(asOf, -RECENT_SALES_WINDOW_DAYS));
  const prevFrom = ymd(addDays(asOf, -(RECENT_SALES_WINDOW_DAYS * 2 - 1)));
  const recent = avgDailySales(sales, recentFrom, asOfDate);
  const previous = avgDailySales(sales, prevFrom, prevTo);
  const comparable = recent && previous && recent.days >= MIN_SALES_DAYS && previous.days >= MIN_SALES_DAYS && previous.avg > 0;

  const thisMonday = addDays(asOf, -((asOf.getDay() + 6) % 7));
  const weekly = Array.from({ length: weeks }, (_, i) => {
    const start = addDays(thisMonday, -7 * (weeks - 1 - i));
    const startStr = ymd(start);
    const endStr = ymd(addDays(start, 6));
    const inWeek = sales.filter((s) => s.date >= startStr && s.date <= endStr && s.date <= asOfDate);
    return { weekStart: startStr, total: inWeek.reduce((sum, s) => sum + s.amount, 0), recordedDays: inWeek.length };
  });

  return { recentDailyAvg: recent?.avg ?? null, previousDailyAvg: previous?.avg ?? null, growthRate: comparable ? recent.avg / previous.avg - 1 : null, weekly };
}
