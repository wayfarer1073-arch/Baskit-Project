'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LanguageSwitcher } from '@/components/i18n/language-switcher';
import { useI18n } from '@/components/i18n/i18n-provider';

/** 화면 언어(한국어/English). 사람마다 다를 수 있어 관리자가 아니어도 바꿀 수 있다. */
export function LanguageSettings() {
  const t = useI18n().m.settingsScreens.language;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <LanguageSwitcher tone="light" className="text-sm [&_button]:px-3 [&_button]:py-1.5" />
      </CardContent>
    </Card>
  );
}
