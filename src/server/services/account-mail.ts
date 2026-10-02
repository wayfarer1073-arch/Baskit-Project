import { format } from '@/lib/i18n/locales';
import type { Messages } from '@/lib/i18n/messages';
import { sendMail } from '@/server/mail';
import { escapeHtml, renderMailHtml } from '@/server/mail-template';
import { issueEmailVerification } from '@/server/repositories/account-repository';

type MailKind = 'verify' | 'reset' | 'invite';

/** 메일 한 통의 HTML — 이름·워크스페이스처럼 사용자가 정한 값은 escape해서 끼운다. */
function buildHtml(m: Messages, kind: MailKind, baseUrl: string, link: string, values: Record<string, string>) {
  const h = m.mail.html;
  const t = h[kind];
  const safe = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, escapeHtml(v)]));
  return renderMailHtml({
    lang: h.lang === 'en' ? 'en' : 'ko',
    baseUrl,
    preheader: format(t.preheader, values),
    heading: format(t.heading, values),
    // 문구 틀은 우리가 쓴 것이라 그대로 두고, 끼우는 값만 escape한 뒤 굵게 표시한다.
    paragraphsHtml: [format(escapeHtml(t.greeting), Object.fromEntries(Object.entries(safe).map(([k, v]) => [k, `<strong>${v}</strong>`]))), escapeHtml(t.body)],
    button: { label: t.button, url: link },
    note: t.note,
    fallbackLabel: h.fallback,
    footnote: t.footnote,
  });
}

export async function sendVerificationMail(m: Messages, baseUrl: string, user: { id: string; email: string; name: string }) {
  const raw = await issueEmailVerification(user.id);
  const link = `${baseUrl}/verify-email?token=${encodeURIComponent(raw)}`;
  return sendMail({
    to: user.email,
    subject: m.mail.verifySubject,
    text: format(m.mail.verifyBody, { name: user.name, link }),
    html: buildHtml(m, 'verify', baseUrl, link, { name: user.name }),
  });
}

export function sendPasswordResetMail(m: Messages, baseUrl: string, target: { raw: string; email: string; name: string }) {
  const link = `${baseUrl}/reset-password?token=${encodeURIComponent(target.raw)}`;
  return sendMail({
    to: target.email,
    subject: m.mail.resetSubject,
    text: format(m.mail.resetBody, { name: target.name, link }),
    html: buildHtml(m, 'reset', baseUrl, link, { name: target.name }),
  });
}

export function sendInvitationMail(m: Messages, baseUrl: string, invite: { raw: string; email: string; workspace: string; inviter: string }) {
  const link = `${baseUrl}/invite?token=${encodeURIComponent(invite.raw)}`;
  const values = { workspace: invite.workspace, inviter: invite.inviter };
  return sendMail({
    to: invite.email,
    subject: format(m.mail.inviteSubject, { workspace: invite.workspace }),
    text: format(m.mail.inviteBody, { ...values, link }),
    html: buildHtml(m, 'invite', baseUrl, link, values),
  });
}
