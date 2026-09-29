import Link from 'next/link';
import { SignupForm } from '@/components/auth/signup-form';
import { LanguageSwitcher } from '@/components/i18n/language-switcher';
import { getMessages } from '@/server/i18n';

export default async function SignupPage() {
  const m = await getMessages();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-sidebar px-4 py-10">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.png" alt="" className="size-14" />
          <p className="text-2xl font-semibold tracking-tight text-sidebar-foreground">{m.auth.signupTitle}</p>
          <p className="text-sm text-sidebar-muted-foreground">{m.auth.signupSubtitle}</p>
        </div>
        <SignupForm />
        <p className="text-center text-sm text-sidebar-muted-foreground">
          {m.auth.haveAccount}{' '}
          <Link href="/login" className="font-medium text-sidebar-foreground underline-offset-4 hover:underline">
            {m.auth.goToLogin}
          </Link>
        </p>
        <div className="flex justify-center">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}
