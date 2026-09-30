import { isDateString } from '@/lib/date';

export interface DashboardRange {
  /** 조회 기준일(기간 비교면 종료일). 오늘을 넘지 않는다. */
  asOfDate: string;
  /** 기간 비교의 시작일. 날짜 하나만 보면 null. */
  fromDate: string | null;
}

/**
 * 대시보드 주소의 날짜 조건 — ?date=(특정 날짜) 또는 ?mode=range&from=&to=(기간 비교).
 * 세 대시보드가 같은 규칙을 쓴다. 미래 날짜는 오늘로, 뒤집힌 기간은 시작일을 종료일로 맞춘다.
 */
export function parseDashboardRange(params: Record<string, string | string[] | undefined>, today: string): DashboardRange {
  const range = params.mode === 'range';
  const requestedTo = isDateString(params.to) ? params.to : isDateString(params.date) ? params.date : today;
  const asOfDate = requestedTo > today ? today : requestedTo;
  if (!range) return { asOfDate, fromDate: null };
  const requestedFrom = isDateString(params.from) ? params.from : asOfDate;
  return { asOfDate, fromDate: requestedFrom > asOfDate ? asOfDate : requestedFrom };
}
