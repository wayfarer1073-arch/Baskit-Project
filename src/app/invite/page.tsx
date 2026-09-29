import { AuthShell } from '@/components/auth/auth-shell';
import { AcceptInviteForm, BackToLogin } from '@/components/auth/account-forms';
import { format } from '@/lib/i18n/locales';
import { getMessages } from '@/server/i18n';
import { findInvitation } from '@/server/repositories/account-repository';

export default async function InvitePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const token = (await searchParams).token;
  const m = await getMessages();
  const invitation = typeof token === 'string' && token ? await findInvitation(token) : null;
  if (!invitation || typeof token !== 'string') {
    return (
      <AuthShell title={m.account.inviteInvalid}>
        <BackToLogin />
      </AuthShell>
    );
  }
  return (
    <AuthShell title={format(m.account.inviteTitle, { workspace: invitation.organizationName })} subtitle={format(m.account.inviteSubtitle, { email: invitation.email })}>
      <AcceptInviteForm token={token} email={invitation.email} />
    </AuthShell>
  );
}
