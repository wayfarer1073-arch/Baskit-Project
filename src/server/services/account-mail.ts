import { format } from '@/lib/i18n/locales';
import type { Messages } from '@/lib/i18n/messages';
import { sendMail } from '@/server/mail';
import { issueEmailVerification } from '@/server/repositories/account-repository';

export async function sendVerificationMail(m: Messages, baseUrl: string, user: { id: string; email: string; name: string }) {
  const raw = await issueEmailVerification(user.id);
  const link = `${baseUrl}/verify-email?token=${encodeURIComponent(raw)}`;
  return sendMail({ to: user.email, subject: m.mail.verifySubject, text: format(m.mail.verifyBody, { name: user.name, link }) });
}

export function sendPasswordResetMail(m: Messages, baseUrl: string, target: { raw: string; email: string; name: string }) {
  const link = `${baseUrl}/reset-password?token=${encodeURIComponent(target.raw)}`;
  return sendMail({ to: target.email, subject: m.mail.resetSubject, text: format(m.mail.resetBody, { name: target.name, link }) });
}

export function sendInvitationMail(m: Messages, baseUrl: string, invite: { raw: string; email: string; workspace: string; inviter: string }) {
  const link = `${baseUrl}/invite?token=${encodeURIComponent(invite.raw)}`;
  return sendMail({
    to: invite.email,
    subject: format(m.mail.inviteSubject, { workspace: invite.workspace }),
    text: format(m.mail.inviteBody, { workspace: invite.workspace, inviter: invite.inviter, link }),
  });
}
