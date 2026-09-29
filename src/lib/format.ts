export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('ko-KR');
}

export function formatCurrency(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

/** 화면 언어에 맞춘 원화 표기 — 한국어는 '1,000원', 영어는 '₩1,000'. */
export function formatMoney(value: number, locale: string): string {
  return locale === 'ko' ? formatCurrency(value) : `₩${Math.round(value).toLocaleString('en-US')}`;
}

export function formatSigned(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${rounded.toLocaleString('ko-KR')}`;
  return rounded.toLocaleString('ko-KR');
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function formatCoverageDays(days: number | null): string {
  if (days === null) return '산정 불가';
  if (!Number.isFinite(days)) return '-';
  return `${Math.floor(days)}일`;
}
