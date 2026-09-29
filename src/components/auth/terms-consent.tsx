'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { useI18n } from '@/components/i18n/i18n-provider';

/** 이용약관·개인정보 처리방침 동의 체크박스. 문구 안의 {terms}·{privacy} 자리에 링크를 넣는다. */
export function TermsConsent({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const { m } = useI18n();
  const links: Record<string, React.ReactNode> = {
    terms: (
      <Link href="/terms" target="_blank" className="font-medium underline underline-offset-4">
        {m.account.terms}
      </Link>
    ),
    privacy: (
      <Link href="/privacy" target="_blank" className="font-medium underline underline-offset-4">
        {m.account.privacy}
      </Link>
    ),
  };
  const parts = m.account.agreeTerms.split(/(\{terms\}|\{privacy\})/);
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" required checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[var(--brand-accent)]" />
      <span>
        {parts.map((part, i) => {
          const key = part.match(/^\{(\w+)\}$/)?.[1];
          return <Fragment key={i}>{key && links[key] ? links[key] : part}</Fragment>;
        })}
      </span>
    </label>
  );
}
