'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useI18n().m.dashboard.errors;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <AlertTriangle className="size-10 text-status-danger" aria-hidden="true" />
      <div>
        <h1 className="text-lg font-semibold">{t.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.body}</p>
        {error.digest && <p className="mt-1 text-xs text-muted-foreground/70">{format(t.code, { code: error.digest })}</p>}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => reset()}>
          {t.retry}
        </Button>
        <Button asChild>
          <Link href="/">{t.home}</Link>
        </Button>
      </div>
    </div>
  );
}
