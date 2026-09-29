import { AuthShell } from '@/components/auth/auth-shell';
import { BackToLogin, ResetPasswordForm } from '@/components/auth/account-forms';
import { getMessages } from '@/server/i18n';

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = (await searchParams).token;
  const m = await getMessages();
  return (
    <AuthShell title={m.account.resetTitle}>
      {typeof token === 'string' && token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p role="alert" className="rounded-lg bg-card px-4 py-3 text-sm">
          {m.account.linkInvalid}
        </p>
      )}
      <BackToLogin />
    </AuthShell>
  );
}
