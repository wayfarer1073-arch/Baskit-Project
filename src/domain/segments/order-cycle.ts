import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

/** 최근 매출 추세를 볼 기간(일). 기준 기간(과거 발주 사이)과 이 기간의 하루 평균 매출을 비교한다. */
export const RECENT_SALES_WINDOW_DAYS = 28;
/** 매출이 입력된 날이 이보다 적으면 비교가 의미 없다고 보고 보정하지 않는다. */
export const MIN_SALES_DAYS = 7;
/** 매출 보정 배수의 상·하한 — 일시적인 매출 급변이 발주 예측을 과하게 흔들지 않도록 한다. */
export const GROWTH_FACTOR_MIN = 0.5;
export const GROWTH_FACTOR_MAX = 2;
/** 평균 발주 간격의 이 배수만큼 발주가 없으면 더 이상 쓰지 않는 품목으로 보고 경고를 멈춘다. */
export const DORMANT_INTERVAL_MULTIPLIER = 3;
/** 권장 발주일까지 이 일수 이하로 남으면 "곧 발주"로 표시한다. */
export const ORDER_SOON_DAYS = 2;

export interface OrderRecord {
  date: string; // yyyy-MM-dd
  quantity: number;
}

export interface SalesRecord {
  date: string;
  amount: number;
}

export type OrderStatus = 'overdue' | 'today' | 'soon' | 'ok' | 'dormant' | 'insufficient';
export type ForecastConfidence = 'high' | 'medium' | 'low' | 'none';

export interface OrderForecast {
  orderCount: number;
  lastOrderDate: string | null;
  lastOrderQuantity: number | null;
  avgIntervalDays: number | null;
  /** 발주 간격의 변동계수(표준편차/평균). 클수록 발주 주기가 들쭉날쭉하다. */
  intervalVariation: number | null;
  avgOrderQuantity: number | null;
  /** 과거 발주 기록만으로 본 하루 사용량(발주 단위). */
  baseDailyUsage: number | null;
  /** 최근 매출 ÷ 과거 매출. 매출 기록이 부족하면 null이고 보정 없이(1배) 예측한다. */
  salesGrowthFactor: number | null;
  adjustedDailyUsage: number | null;
  expectedRunOutDate: string | null;
  recommendedOrderDate: string | null;
  daysUntilOrder: number | null;
  recommendedQuantity: number | null;
  status: OrderStatus;
  confidence: ForecastConfidence;
}

function avgDailySales(sales: SalesRecord[], fromInclusive: string, toInclusive: string): { avg: number; days: number } | null {
  const inRange = sales.filter((s) => s.date >= fromInclusive && s.date <= toInclusive);
  if (inRange.length === 0) return null;
  return { avg: inRange.reduce((sum, s) => sum + s.amount, 0) / inRange.length, days: inRange.length };
}

/**
 * 과거(발주 기록이 쌓인 기간)의 하루 평균 매출 대비 최근 4주 하루 평균 매출. 매출을 매일 입력하지
 * 않는 매장이 많아 "입력된 날"의 평균끼리 비교한다. 양쪽 모두 입력일이 충분할 때만 값을 낸다.
 */
export function salesGrowthFactor(sales: SalesRecord[], baselineFrom: string, baselineTo: string, asOfDate: string): number | null {
  const recentFrom = format(addDays(parseISO(asOfDate), -(RECENT_SALES_WINDOW_DAYS - 1)), 'yyyy-MM-dd');
  const recent = avgDailySales(sales, recentFrom, asOfDate);
  const baseline = avgDailySales(sales, baselineFrom, baselineTo);
  if (!recent || !baseline || recent.days < MIN_SALES_DAYS || baseline.days < MIN_SALES_DAYS || baseline.avg <= 0) return null;
  return Math.min(GROWTH_FACTOR_MAX, Math.max(GROWTH_FACTOR_MIN, recent.avg / baseline.avg));
}

function roundQuantity(value: number, integerUnits: boolean): number {
  return integerUnits ? Math.ceil(value - 1e-9) : Math.round(value * 10) / 10;
}

/**
 * 재고를 세지 않는 매장의 다음 발주일 예측.
 *
 * i번째 발주량은 다음 발주 전까지 모두 쓴 것으로 보고, 하루 사용량 = (마지막 발주를 뺀 발주량 합) ÷
 * (첫 발주일 ~ 마지막 발주일 일수)로 구한다. 여기에 최근 매출 증감 배수를 곱해 마지막 발주량이
 * 바닥나는 날을 예측하고, 품목별 리드타임만큼 앞당긴 날을 권장 발주일로 삼는다.
 */
export function forecastNextOrder(
  orders: OrderRecord[],
  sales: SalesRecord[],
  asOfDate: string,
  leadTimeDays: number,
): OrderForecast {
  const sorted = orders.filter((o) => o.date <= asOfDate && o.quantity > 0).sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.at(-1) ?? null;
  const empty: OrderForecast = {
    orderCount: sorted.length,
    lastOrderDate: last?.date ?? null,
    lastOrderQuantity: last?.quantity ?? null,
    avgIntervalDays: null,
    intervalVariation: null,
    avgOrderQuantity: last ? sorted.reduce((s, o) => s + o.quantity, 0) / sorted.length : null,
    baseDailyUsage: null,
    salesGrowthFactor: null,
    adjustedDailyUsage: null,
    expectedRunOutDate: null,
    recommendedOrderDate: null,
    daysUntilOrder: null,
    recommendedQuantity: null,
    status: 'insufficient',
    confidence: 'none',
  };

  // 같은 날 여러 번 나눠 발주한 건 하나로 합친다(간격 0일 구간이 생기지 않도록).
  const merged: OrderRecord[] = [];
  for (const o of sorted) {
    const prev = merged.at(-1);
    if (prev && prev.date === o.date) prev.quantity += o.quantity;
    else merged.push({ ...o });
  }
  if (merged.length < 2) return { ...empty, orderCount: merged.length };

  const first = merged[0];
  const lastOrder = merged[merged.length - 1];
  const intervals = merged.slice(1).map((o, i) => differenceInCalendarDays(parseISO(o.date), parseISO(merged[i].date)));
  const spanDays = differenceInCalendarDays(parseISO(lastOrder.date), parseISO(first.date));
  const consumed = merged.slice(0, -1).reduce((s, o) => s + o.quantity, 0);
  const baseDailyUsage = consumed / spanDays;

  const avgIntervalDays = spanDays / intervals.length;
  const variance = intervals.reduce((s, d) => s + (d - avgIntervalDays) ** 2, 0) / intervals.length;
  const intervalVariation = avgIntervalDays > 0 ? Math.sqrt(variance) / avgIntervalDays : null;
  const avgOrderQuantity = merged.reduce((s, o) => s + o.quantity, 0) / merged.length;

  const growth = salesGrowthFactor(sales, first.date, lastOrder.date, asOfDate);
  const adjustedDailyUsage = baseDailyUsage * (growth ?? 1);

  const daysOfSupply = adjustedDailyUsage > 0 ? lastOrder.quantity / adjustedDailyUsage : null;
  const expectedRunOutDate = daysOfSupply === null ? null : format(addDays(parseISO(lastOrder.date), Math.floor(daysOfSupply)), 'yyyy-MM-dd');
  const recommendedOrderDate = expectedRunOutDate === null ? null : format(addDays(parseISO(expectedRunOutDate), -leadTimeDays), 'yyyy-MM-dd');
  const daysUntilOrder = recommendedOrderDate === null ? null : differenceInCalendarDays(parseISO(recommendedOrderDate), parseISO(asOfDate));

  const integerUnits = merged.every((o) => Number.isInteger(o.quantity));
  const recommendedQuantity = roundQuantity(adjustedDailyUsage * avgIntervalDays, integerUnits);

  const daysSinceLastOrder = differenceInCalendarDays(parseISO(asOfDate), parseISO(lastOrder.date));
  let status: OrderStatus;
  if (daysSinceLastOrder > avgIntervalDays * DORMANT_INTERVAL_MULTIPLIER) status = 'dormant';
  else if (daysUntilOrder === null) status = 'insufficient';
  else if (daysUntilOrder < 0) status = 'overdue';
  else if (daysUntilOrder === 0) status = 'today';
  else if (daysUntilOrder <= ORDER_SOON_DAYS) status = 'soon';
  else status = 'ok';

  let confidence: ForecastConfidence;
  if (intervals.length >= 4 && (intervalVariation ?? 1) <= 0.35) confidence = 'high';
  else if (intervals.length >= 2 && (intervalVariation ?? 1) <= 0.6) confidence = 'medium';
  else confidence = 'low';

  return {
    orderCount: merged.length,
    lastOrderDate: lastOrder.date,
    lastOrderQuantity: lastOrder.quantity,
    avgIntervalDays,
    intervalVariation,
    avgOrderQuantity,
    baseDailyUsage,
    salesGrowthFactor: growth,
    adjustedDailyUsage,
    expectedRunOutDate,
    recommendedOrderDate,
    daysUntilOrder,
    recommendedQuantity,
    status,
    confidence,
  };
}

export interface SalesTrend {
  recentDailyAvg: number | null;
  previousDailyAvg: number | null;
  /** 최근 4주 vs 그 이전 4주 하루 평균 매출 증감률. 비교할 수 없으면 null. */
  growthRate: number | null;
  weekly: { weekStart: string; total: number; recordedDays: number }[];
}

/** 대시보드 요약용 매출 추세 — 최근 4주/직전 4주 비교와 주간(월요일 시작) 합계. */
export function summarizeSales(sales: SalesRecord[], asOfDate: string, weeks = 12): SalesTrend {
  const asOf = parseISO(asOfDate);
  const recentFrom = format(addDays(asOf, -(RECENT_SALES_WINDOW_DAYS - 1)), 'yyyy-MM-dd');
  const prevTo = format(addDays(asOf, -RECENT_SALES_WINDOW_DAYS), 'yyyy-MM-dd');
  const prevFrom = format(addDays(asOf, -(RECENT_SALES_WINDOW_DAYS * 2 - 1)), 'yyyy-MM-dd');
  const recent = avgDailySales(sales, recentFrom, asOfDate);
  const previous = avgDailySales(sales, prevFrom, prevTo);
  const comparable = recent && previous && recent.days >= MIN_SALES_DAYS && previous.days >= MIN_SALES_DAYS && previous.avg > 0;

  const mondayOffset = (asOf.getDay() + 6) % 7;
  const thisMonday = addDays(asOf, -mondayOffset);
  const weekly = Array.from({ length: weeks }, (_, i) => {
    const start = addDays(thisMonday, -7 * (weeks - 1 - i));
    const startStr = format(start, 'yyyy-MM-dd');
    const endStr = format(addDays(start, 6), 'yyyy-MM-dd');
    const inWeek = sales.filter((s) => s.date >= startStr && s.date <= endStr && s.date <= asOfDate);
    return { weekStart: startStr, total: inWeek.reduce((sum, s) => sum + s.amount, 0), recordedDays: inWeek.length };
  });

  return {
    recentDailyAvg: recent?.avg ?? null,
    previousDailyAvg: previous?.avg ?? null,
    growthRate: comparable ? recent.avg / previous.avg - 1 : null,
    weekly,
  };
}

const STATUS_RANK: Record<OrderStatus, number> = { overdue: 0, today: 1, soon: 2, ok: 3, insufficient: 4, dormant: 5 };

export function compareOrderUrgency(a: OrderForecast, b: OrderForecast): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.daysUntilOrder ?? Infinity) - (b.daysUntilOrder ?? Infinity);
}
