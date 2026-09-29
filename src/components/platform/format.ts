import { formatKstDateTime } from '@/lib/date';
import { format } from '@/lib/i18n/locales';
import type { Messages } from '@/lib/i18n/messages';

/** "방금 / N분 전 / N시간 전 / N일 전", 30일이 넘으면 날짜로. */
export function timeAgo(iso: string | null, t: Messages['platform']['time'], now = Date.now()): string {
  if (!iso) return '—';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t.now;
  if (min < 60) return format(t.minutes, { n: min });
  const hours = Math.floor(min / 60);
  if (hours < 24) return format(t.hours, { n: hours });
  const days = Math.floor(hours / 24);
  if (days <= 30) return format(t.days, { n: days });
  return formatKstDateTime(iso).slice(0, 10);
}
