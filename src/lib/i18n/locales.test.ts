import { describe, expect, it } from 'vitest';
import { format, localeFromAcceptLanguage } from './locales';
import { MESSAGES } from './messages';

describe('i18n helpers', () => {
  it('picks the first supported language from Accept-Language', () => {
    expect(localeFromAcceptLanguage('en-US,en;q=0.9,ko;q=0.8')).toBe('en');
    expect(localeFromAcceptLanguage('ko-KR,ko;q=0.9')).toBe('ko');
    expect(localeFromAcceptLanguage('fr-FR,de;q=0.8')).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it('fills placeholders and leaves unknown ones untouched', () => {
    expect(format('{count} rows by {name}', { count: 3, name: 'Kim' })).toBe('3 rows by Kim');
    expect(format('{missing}', {})).toBe('{missing}');
  });

  it('keeps the same keys and placeholders in every language', () => {
    const walk = (a: unknown, b: unknown, path: string) => {
      if (typeof a === 'string') {
        expect(typeof b, path).toBe('string');
        const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect(vars(b as string), path).toEqual(vars(a));
        return;
      }
      expect(Object.keys(b as object).sort(), path).toEqual(Object.keys(a as object).sort());
      for (const key of Object.keys(a as object)) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
    };
    walk(MESSAGES.ko, MESSAGES.en, 'messages');
  });
});
