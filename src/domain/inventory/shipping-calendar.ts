const DAY_MS = 86_400_000;
/** 'YYYY-MM-DD' → UTC 자정 시각. 날짜 문자열만 다루므로 시간대와 무관하다(date-fns 파싱보다 훨씬 빠르다 — 품목마다 수천 번 부른다). */
const utcOf = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
// 대시보드 한 번에 품목 수백 개 × 수십 일을 하루씩 넘기며 세므로 '다음 날'과 요일을 기억해 둔다(날짜 종류는 많지 않다).
const CACHE_LIMIT = 50_000;
const weekdayCache = new Map<string, number>();
const nextDayCache = new Map<string, string>();
function remember<V>(cache: Map<string, V>, key: string, value: V): V {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}
export const weekdayOf = (date: string) => weekdayCache.get(date) ?? remember(weekdayCache, date, new Date(utcOf(date)).getUTCDay());
/** to − from (달력 일수). */
export const daysBetween = (from: string, to: string) => Math.round((utcOf(to) - utcOf(from)) / DAY_MS);

/**
 * 쉬는 날 목록(등록 휴무일). workedDays는 주말·휴무일인데도 실제로 재고 자료가 올라온 날 — 그날은 일한 날로
 * 본다(설정에서 휴무일 업로드를 켰을 때 생긴다. 나중에 꺼도 이미 올라온 날은 그대로 일한 날로 남는다).
 * 보통의 Set으로도 쓸 수 있도록 선택 속성으로 둔다.
 */
export type ClosedDays = ReadonlySet<string> & {
  readonly workedDays?: ReadonlySet<string>;
  /** 등록하지 않았지만 자료로 알아낸 쉬는 날(평소 매일 나가던 품목이 모두 멈춘 평일). 이날 올라온 재고는 분석에서 뺀다. */
  readonly detectedClosed?: ReadonlySet<string>;
};

export const NO_HOLIDAYS: ClosedDays = new Set();

export function closedDays(holidays: Iterable<string>, workedDays: Iterable<string> = [], detectedClosed: Iterable<string> = []): ClosedDays {
  const detected = new Set(detectedClosed);
  const set = new Set([...holidays, ...detected]) as Set<string> & { workedDays?: ReadonlySet<string>; detectedClosed?: ReadonlySet<string> };
  set.workedDays = new Set([...workedDays].filter((d) => !detected.has(d)));
  set.detectedClosed = detected;
  return set;
}

/** 자료로 쉬는 날을 알아내는 기준 — 그날 재고가 바뀐 품목 비율이 이 이하이고, 평소(중앙값) 비율은 이 이상. */
const CLOSED_CHANGED_SHARE = 0.03;
const CLOSED_TYPICAL_SHARE = 0.15;
const CLOSED_MIN_ITEMS = 10;

/**
 * 등록 휴무일이 아닌 평일인데 창고 전체가 멈춘 날 — 전날과 견줘 재고가 바뀐 품목이 거의 없고(3% 이하),
 * 평소에는 꽤 바뀌는(중앙값 15% 이상) 창고일 때. 공휴일·대체휴일·창고 휴무를 등록하지 않아도
 * '아무것도 안 나간 날 + 다음 날 몰아서 출고'를 소진 흐름으로 잘못 읽지 않게 한다.
 */
export function detectClosedDays(stats: { date: string; present: number; changed: number }[], holidays: ClosedDays = NO_HOLIDAYS): string[] {
  const usable = stats.filter((s) => s.present >= CLOSED_MIN_ITEMS);
  if (usable.length < 5) return [];
  const shares = usable.map((s) => s.changed / s.present).sort((a, b) => a - b);
  const typical = shares[Math.floor((shares.length - 1) / 2)];
  if (typical < CLOSED_TYPICAL_SHARE) return [];
  return usable.filter((s) => s.changed / s.present <= CLOSED_CHANGED_SHARE && isShippingDay(s.date, holidays)).map((s) => s.date);
}
export function shiftDate(date: string, days: number): string {
  if (days === 1) return nextDayCache.get(date) ?? remember(nextDayCache, date, new Date(utcOf(date) + DAY_MS).toISOString().slice(0, 10));
  return new Date(utcOf(date) + days * DAY_MS).toISOString().slice(0, 10);
}
export function isShippingDay(date: string, holidays: ClosedDays = NO_HOLIDAYS): boolean {
  if (holidays.workedDays?.has(date)) return true;
  const day = weekdayOf(date);
  return day !== 0 && day !== 6 && !holidays.has(date);
}
/** Close-of-day snapshots: count shipping days in (previous observation, current observation]. */
export function shippingDaysBetween(from: string, to: string, holidays: ReadonlySet<string> = NO_HOLIDAYS): number {
  let count = 0;
  for (let day = shiftDate(from, 1); day <= to; day = shiftDate(day, 1)) {
    if (isShippingDay(day, holidays)) count++;
  }
  return count;
}
export function latestShippingDay(date: string, holidays: ReadonlySet<string> = NO_HOLIDAYS): string {
  let day = date;
  while (!isShippingDay(day, holidays)) day = shiftDate(day, -1);
  return day;
}
/** No fractional shipping date: exhaust on the next whole shipping day. Cap unrealistic horizons. */
export function shippingDateAfter(from: string, days: number, holidays: ReadonlySet<string> = NO_HOLIDAYS): string | null {
  if (!Number.isFinite(days) || days < 0 || days > 2600) return null;
  let left = Math.ceil(days);
  let date = from;
  while (left > 0) {
    date = shiftDate(date, 1);
    if (isShippingDay(date, holidays)) left--;
  }
  return date;
}

/**
 * 주문(수요)이 생기는 날 — 주말을 뺀 모든 날. 등록 휴무일은 출고가 없을 뿐 주문은 계속 쌓여 휴무 뒤 첫 출고일에
 * 한꺼번에 빠지므로, 소진 속도의 분모와 소진 예상일에서는 휴무일도 하루로 센다. 주말은 매주 똑같이 반복되어
 * 이미 "출고일당 소진량"에 녹아 있으므로 세지 않는다(평소 한 주 = 5일, 휴무가 낀 주도 5일).
 */
export function isDemandDay(date: string, holidays: ClosedDays = NO_HOLIDAYS): boolean {
  if (holidays.workedDays?.has(date)) return true;
  const day = weekdayOf(date);
  return day !== 0 && day !== 6;
}
/** (from, to] 구간의 수요일 수 = 출고일 + 평일에 걸친 등록 휴무일 (+ 자료가 올라온 주말). */
export function demandDaysBetween(from: string, to: string, holidays: ClosedDays = NO_HOLIDAYS): number {
  let count = 0;
  for (let day = shiftDate(from, 1); day <= to; day = shiftDate(day, 1)) {
    if (isDemandDay(day, holidays)) count++;
  }
  return count;
}
