import Link from 'next/link';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { getMessages } from '@/server/i18n';
import { verifyEmail } from '@/server/repositories/account-repository';

/** 인증 메일의 링크. 열면 바로 인증된다(토큰은 한 번만 쓸 수 있다). */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = (await searchParams).token;
  const m = await getMessages();
  const ok = typeof token === 'string' && token.length > 10 && (await verifyEmail(token));
  return (
    <AuthShell title={ok ? m.account.verifyOk : m.account.verifyFailed}>
      <div className="flex justify-center">
        <Button asChild>
          <Link href="/">{m.account.goToApp}</Link>
        </Button>
      </div>
    </AuthShell>
  );
}
