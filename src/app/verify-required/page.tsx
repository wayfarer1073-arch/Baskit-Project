import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { VerifyRequiredActions } from '@/components/auth/verify-required-actions';
import { auth } from '@/server/auth';
import { getMessages } from '@/server/i18n';
import { format } from '@/lib/i18n/locales';
import { getAccountStatus } from '@/server/repositories/account-repository';
import { mustVerifyEmail } from '@/server/email-verification';

/** 이메일 인증을 마치지 않은 사용자가 앱 대신 보는 화면 — 인증 메일 다시 보내기·인증 후 들어가기·로그아웃. */
export default async function VerifyRequiredPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const account = await getAccountStatus(session.user.id);
  if (!account || !mustVerifyEmail(account)) redirect('/');
  const m = await getMessages();
  return (
    <AuthShell title={m.account.verifyRequiredTitle} subtitle={format(m.account.verifyRequiredBody, { email: account.email })}>
      <VerifyRequiredActions />
    </AuthShell>
  );
}
