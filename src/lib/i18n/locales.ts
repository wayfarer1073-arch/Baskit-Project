export const LOCALES = ['ko', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ko';
/** 사용자가 고른 화면 언어. 없으면 브라우저 언어(Accept-Language)를 보고, 그래도 없으면 한국어. */
export const LOCALE_COOKIE = 'limenote_locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** "ko-KR,ko;q=0.9,en;q=0.8" 같은 헤더에서 지원하는 첫 언어를 고른다. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase().slice(0, 2);
    if (isLocale(tag)) return tag;
  }
  return null;
}

/** "{count}건" 같은 자리표시자를 값으로 채운다. 없는 키는 그대로 둔다. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
