import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, localeFromAcceptLanguage, type Locale } from '@/lib/i18n/locales';
import { MESSAGES, type Messages } from '@/lib/i18n/messages';

/** 요청의 화면 언어 — 사용자가 고른 쿠키 > 브라우저 언어 > 한국어. */
export const getLocale = cache(async (): Promise<Locale> => {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return localeFromAcceptLanguage((await headers()).get('accept-language')) ?? DEFAULT_LOCALE;
});

export async function getMessages(): Promise<Messages> {
  return MESSAGES[await getLocale()];
}
