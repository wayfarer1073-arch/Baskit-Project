import { DEFAULT_EXPIRATION_RISK_DAYS } from '@/domain/inventory/types';
import { todayKstDateString } from '@/lib/date';

/** 기준일(기본 오늘, KST)부터 소비기한까지 남은 일수. 지났으면 음수. */
export function daysUntilDate(date: string, from: string = todayKstDateString()) {
  return Math.round((Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

/** 소비기한이 임박 기준 안으로 들어왔는지(지난 것 포함). 기준이 없으면 앱 기본값을 쓴다. */
export function isExpirationNear(date: string, riskDays: number | null, from?: string) {
  return daysUntilDate(date, from) <= (riskDays ?? DEFAULT_EXPIRATION_RISK_DAYS);
}
