import Link from 'next/link';
import { LanguageSwitcher } from '@/components/i18n/language-switcher';
import type { LegalDoc } from '@/lib/legal';

export function LegalPage({ doc, homeLabel }: { doc: LegalDoc; homeLabel: string }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.png" alt="" className="size-6" />
          {homeLabel}
        </Link>
        <LanguageSwitcher />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{doc.effective}</p>
      <div className="mt-8 space-y-6">
        {doc.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-base font-semibold">{s.heading}</h2>
            {s.body.map((p, i) => (
              <p key={i} className="mt-2 text-sm leading-relaxed text-foreground/90">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
