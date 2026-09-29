import type { PeriodicStatus } from '@/domain/segments/periodic-count';
import { format } from '@/lib/i18n/locales';
import type { Messages } from '@/lib/i18n/messages';

export const STATUS_VARIANT: Record<PeriodicStatus, 'danger' | 'warning' | 'normal' | 'stagnant'> = {
  estimated_out: 'danger',
  soon: 'warning',
  ok: 'normal',
  unknown: 'stagnant',
};

/** 계산이 돌려준 실사 권장 사유(한국어)를 화면 언어로. 모르는 문구는 그대로. */
export function recountReasonText(reason: string, t: Messages['periodic']['reasons']): string {
  const elapsed = reason.match(/^마지막 실사 후 (\d+)일 경과$/);
  if (elapsed) return format(t.elapsed, { days: elapsed[1] });
  if (reason.startsWith('추정상 품절 임박')) return t.soon;
  if (reason.startsWith('소진 속도를 알려면')) return t.needAnother;
  return reason;
}
