import { redirect } from 'next/navigation';
import { todayKstDateString } from '@/lib/date';

/** 실사 입력은 캘린더로 합쳐졌다 — 예전 주소는 오늘 날짜의 비정기 실사 입력 패널을 연다. */
export default function CountPage() {
  redirect(`/upload?date=${todayKstDateString()}&mode=PERIODIC_COUNT`);
}
