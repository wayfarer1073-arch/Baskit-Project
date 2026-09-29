import { AuthShell } from '@/components/auth/auth-shell';
import { BackToLogin, ForgotPasswordForm } from '@/components/auth/account-forms';
import { getMessages } from '@/server/i18n';

export default async function ForgotPasswordPage() {
  const m = await getMessages();
  return (
    <AuthShell title={m.account.forgotTitle} subtitle={m.account.forgotSubtitle}>
      <ForgotPasswordForm />
      <BackToLogin />
    </AuthShell>
  );
}
