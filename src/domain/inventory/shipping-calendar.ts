import { addDays, format, parseISO } from 'date-fns';

/**
 * 쉬는 날 목록(등록 휴무일). workedDays는 주말·휴무일인데도 실제로 재고 자료가 올라온 날 — 그날은 일한 날로
 * 본다(설정에서 휴무일 업로드를 켰을 때 생긴다. 나중에 꺼도 이미 올라온 날은 그대로 일한 날로 남는다).
 * 보통의 Set으로도 쓸 수 있도록 선택 속성으로 둔다.
 */
export type ClosedDays = ReadonlySet<string> & { readonly workedDays?: ReadonlySet<string> };

export const NO_HOLIDAYS: ClosedDays = new Set();

export function closedDays(holidays: Iterable<string>, workedDays: Iterable<string> = []): ClosedDays {
  const set = new Set(holidays) as Set<string> & { workedDays?: ReadonlySet<string> };
  set.workedDays = new Set(workedDays);
  return set;
}
export function shiftDate(date: string, days: number): string {
  return format(addDays(parseISO(date), days), 'yyyy-MM-dd');
}
export function isShippingDay(date: string, holidays: ClosedDays = NO_HOLIDAYS): boolean {
  if (holidays.workedDays?.has(date)) return true;
  const day = parseISO(date).getDay();
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
  const day = parseISO(date).getDay();
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
