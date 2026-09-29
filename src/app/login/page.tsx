import Link from 'next/link';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';
import { LanguageSwitcher } from '@/components/i18n/language-switcher';
import { getMessages } from '@/server/i18n';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const blocked = (await searchParams).reason === 'blocked';
  const m = await getMessages();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.png" alt="" className="size-14" />
          <p className="text-2xl font-semibold tracking-tight text-sidebar-foreground">Limenote</p>
          <p className="text-sm text-sidebar-muted-foreground">{m.auth.loginSubtitle}</p>
        </div>
        {blocked && (
          <p role="alert" className="rounded-lg border border-status-warning/40 bg-status-warning-bg px-4 py-3 text-sm text-status-warning">
            {m.auth.blocked}
          </p>
        )}
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
        <p className="-mt-4 text-center text-sm">
          <Link href="/forgot-password" className="text-sidebar-muted-foreground underline-offset-4 hover:text-sidebar-foreground hover:underline">
            {m.account.forgotLink}
          </Link>
        </p>
        <p className="text-center text-sm text-sidebar-muted-foreground">
          {m.auth.newHere}{' '}
          <Link href="/signup" className="font-medium text-sidebar-foreground underline-offset-4 hover:underline">
            {m.auth.createWorkspace}
          </Link>
        </p>
        <div className="flex justify-center">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}
