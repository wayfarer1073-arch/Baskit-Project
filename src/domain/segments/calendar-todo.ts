import { shiftDate } from '@/domain/inventory/shipping-calendar';

/**
 * 매출을 적지 않은 날 — 매장 기록을 시작한 날(첫 매출·첫 발주 중 빠른 날)과 최근 lookbackDays일 중 늦은 날부터
 * 어제까지. 오늘 매출은 보통 영업이 끝난 뒤 적으므로 빼고 센다. 기록을 한 번도 안 했으면 빈 배열.
 */
export function missingSalesDates(salesDates: ReadonlySet<string>, firstActivityDate: string | null, today: string, lookbackDays = 14): string[] {
  if (!firstActivityDate) return [];
  const windowStart = shiftDate(today, -lookbackDays);
  let date = firstActivityDate > windowStart ? firstActivityDate : windowStart;
  const yesterday = shiftDate(today, -1);
  const missing: string[] = [];
  while (date <= yesterday) {
    if (!salesDates.has(date)) missing.push(date);
    date = shiftDate(date, 1);
  }
  return missing;
}
