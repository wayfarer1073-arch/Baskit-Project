'use client';

import { STORE_DEFAULT_EXPIRATION_RISK_DAYS } from '@/domain/segments/store-expiration';
import { daysUntilDate } from '@/lib/expiration-days';
import { formatExpirationDday } from '@/lib/status';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

/**
 * 발주분 소비기한 표시 — "소비기한 10-05 · D-3". 임박 기준(일) 안이거나 지났으면 빨간색.
 * 기준일(asOf)을 주지 않으면 오늘부터 센다.
 */
export function ExpiryBadge({ date, riskDays, asOf, className }: { date: string; riskDays?: number | null; asOf?: string; className?: string }) {
  const t = useI18n().m.store.expiry;
  const daysLeft = daysUntilDate(date, asOf);
  const near = daysLeft <= (riskDays ?? STORE_DEFAULT_EXPIRATION_RISK_DAYS);
  return (
    <span
      title={date}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap tabular-nums',
        near ? 'bg-status-danger-bg font-semibold text-status-danger' : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {format(t.badge, { date: date.slice(5), dday: formatExpirationDday(daysLeft) })}
    </span>
  );
}
