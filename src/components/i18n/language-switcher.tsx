'use client';

import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { useI18n } from '@/components/i18n/i18n-provider';
import { LOCALES, LOCALE_COOKIE, type Locale } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';

function writeLocaleCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

/** 한국어/English 전환. 고른 언어는 1년간 쿠키로 기억한다. */
export function LanguageSwitcher({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  const { locale, m } = useI18n();
  const router = useRouter();

  function choose(next: Locale) {
    if (next === locale) return;
    writeLocaleCookie(next);
    router.refresh();
  }

  return (
    <div role="group" aria-label={m.common.language} className={cn('inline-flex items-center gap-1 text-xs', className)}>
      <Languages className={cn('size-3.5', tone === 'dark' ? 'text-sidebar-muted-foreground' : 'text-muted-foreground')} aria-hidden="true" />
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === locale}
          onClick={() => choose(l)}
          className={cn(
            'rounded-md px-1.5 py-0.5 transition-colors',
            l === locale
              ? tone === 'dark'
                ? 'bg-sidebar-hover-bg font-medium text-sidebar-foreground'
                : 'bg-muted font-medium text-foreground'
              : tone === 'dark'
                ? 'text-sidebar-muted-foreground hover:text-sidebar-foreground'
                : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {m.common.languageNames[l]}
        </button>
      ))}
    </div>
  );
}
