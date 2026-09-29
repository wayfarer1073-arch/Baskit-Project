'use client';

import { createContext, useContext } from 'react';
import type { Locale } from '@/lib/i18n/locales';
import { MESSAGES, type Messages } from '@/lib/i18n/messages';

const I18nContext = createContext<{ locale: Locale; m: Messages }>({ locale: 'ko', m: MESSAGES.ko });

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <I18nContext.Provider value={{ locale, m: MESSAGES[locale] }}>{children}</I18nContext.Provider>;
}

/** 현재 화면 언어와 문구 사전. 자리표시자는 `format(m.x, { ... })`로 채운다. */
export function useI18n() {
  return useContext(I18nContext);
}
