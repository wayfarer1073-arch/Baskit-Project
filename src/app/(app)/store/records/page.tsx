import { redirect } from 'next/navigation';
import { todayKstDateString } from '@/lib/date';

/** 발주·매출 기록은 캘린더로 합쳐졌다 — 예전 주소는 오늘 날짜의 매장 매출·발주 패널을 연다. */
export default function StoreRecordsPage() {
  redirect(`/upload?date=${todayKstDateString()}&mode=ORDER_CYCLE`);
}
