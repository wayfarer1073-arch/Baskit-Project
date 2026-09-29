import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { MESSAGES } from '../src/lib/i18n/messages';
import { cleanupFixture, createFixture, requireTestDatabase } from './db-fixtures';
import { devOutbox } from '../src/server/mail';
import {
  acceptInvitation,
  createInvitation,
  findInvitation,
  InvitationError,
  requestPasswordReset,
  resetPassword,
  revokeInvitation,
  verifyEmail,
} from '../src/server/repositories/account-repository';
import { sendInvitationMail, sendPasswordResetMail, sendVerificationMail } from '../src/server/services/account-mail';

requireTestDatabase();
let a: Awaited<ReturnType<typeof createFixture>>;
beforeEach(async () => {
  a = await createFixture();
});
afterEach(async () => {
  await cleanupFixture(a);
});
afterAll(() => prisma.$disconnect());

const m = MESSAGES.ko;
const BASE = 'https://app.test';
function lastLinkToken(path: string): string {
  const mail = devOutbox().at(-1)!;
  const match = mail.text.match(new RegExp(`${BASE}${path}\\?token=([^\\s]+)`));
  if (!match) throw new Error(`no ${path} link in: ${mail.text}`);
  return decodeURIComponent(match[1]);
}

it('verifies an email with a one-time link', async () => {
  await sendVerificationMail(m, BASE, { id: a.user.id, email: a.user.email, name: a.user.name });
  const first = lastLinkToken('/verify-email');
  // 다시 보내면 이전 링크는 무효가 된다.
  await sendVerificationMail(m, BASE, { id: a.user.id, email: a.user.email, name: a.user.name });
  const second = lastLinkToken('/verify-email');
  expect(await verifyEmail(first)).toBe(false);
  expect(await verifyEmail(second)).toBe(true);
  expect(await verifyEmail(second)).toBe(false);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).emailVerifiedAt).not.toBeNull();
});

it('resets a password once and only for registered accounts', async () => {
  expect(await requestPasswordReset('nobody@test.invalid')).toBeNull();
  const target = await requestPasswordReset(a.user.email.toUpperCase());
  expect(target).not.toBeNull();
  await sendPasswordResetMail(m, BASE, target!);
  const token = lastLinkToken('/reset-password');
  expect(await resetPassword(token, 'brand-new-pass')).toBe(true);
  expect(await resetPassword(token, 'another-pass-1')).toBe(false);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } });
  expect(await bcrypt.compare('brand-new-pass', user.passwordHash)).toBe(true);

  // 만료된 링크는 쓸 수 없다.
  const expired = await requestPasswordReset(a.user.email);
  await prisma.authToken.updateMany({ where: { userId: a.user.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
  expect(await resetPassword(expired!.raw, 'late-password')).toBe(false);
});

it('invites a teammate who joins with the chosen role', async () => {
  const email = `invitee-${a.org.id}@test.invalid`;
  const invite = await createInvitation(a.org.id, { email, role: 'VIEWER', invitedById: a.user.id });
  await sendInvitationMail(m, BASE, { raw: invite.raw, email, workspace: a.org.name, inviter: a.user.name });
  const token = lastLinkToken('/invite');
  expect((await findInvitation(token))?.organizationId).toBe(a.org.id);

  const user = await acceptInvitation(token, { name: '초대 받은 사람', password: 'invitee-pass' });
  const created = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(created).toMatchObject({ organizationId: a.org.id, role: 'VIEWER' });
  expect(created.emailVerifiedAt).not.toBeNull();
  expect(created.termsAcceptedAt).not.toBeNull();
  await expect(acceptInvitation(token, { name: 'again', password: 'invitee-pass' })).rejects.toBeInstanceOf(InvitationError);

  // 이미 가입된 이메일은 초대할 수 없다.
  await expect(createInvitation(a.org.id, { email: a.user.email, role: 'MEMBER', invitedById: a.user.id })).rejects.toMatchObject({ code: 'email_taken' });
});

it('revoked invitations cannot be used', async () => {
  const invite = await createInvitation(a.org.id, { email: `revoked-${a.org.id}@test.invalid`, role: 'MEMBER', invitedById: a.user.id });
  const [pending] = await prisma.invitation.findMany({ where: { organizationId: a.org.id } });
  expect(await revokeInvitation(a.org.id, pending.id)).toBe(true);
  expect(await findInvitation(invite.raw)).toBeNull();
});
