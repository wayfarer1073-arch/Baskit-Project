import { hashPassword } from '@/lib/password';
import { Prisma, type Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createOneTimeToken, hashOneTimeToken } from '@/server/one-time-token';

const HOUR = 3_600_000;
export const EMAIL_VERIFY_TTL_MS = 48 * HOUR;
export const PASSWORD_RESET_TTL_MS = 1 * HOUR;
export const INVITATION_TTL_MS = 7 * 24 * HOUR;

async function issue(userId: string, type: 'EMAIL_VERIFY' | 'PASSWORD_RESET', ttlMs: number): Promise<string> {
  const { raw, hash } = createOneTimeToken();
  await prisma.$transaction([
    // 새 링크를 보내면 이전 링크는 쓸 수 없게 한다.
    prisma.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.authToken.create({ data: { userId, type, tokenHash: hash, expiresAt: new Date(Date.now() + ttlMs) } }),
  ]);
  return raw;
}

async function consume(raw: string, type: 'EMAIL_VERIFY' | 'PASSWORD_RESET') {
  const token = await prisma.authToken.findUnique({ where: { tokenHash: hashOneTimeToken(raw) }, include: { user: { select: { id: true, isActive: true } } } });
  if (!token || token.type !== type || token.usedAt || token.expiresAt < new Date() || !token.user.isActive) return null;
  // 동시에 두 번 눌러도 한 번만 성공하도록 usedAt이 비어 있을 때만 표시한다.
  const marked = await prisma.authToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
  return marked.count === 1 ? token.user.id : null;
}

// ─── 이메일 인증 ─────────────────────────────────────────────

export function issueEmailVerification(userId: string) {
  return issue(userId, 'EMAIL_VERIFY', EMAIL_VERIFY_TTL_MS);
}

export async function verifyEmail(raw: string): Promise<boolean> {
  const userId = await consume(raw, 'EMAIL_VERIFY');
  if (!userId) return false;
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  return true;
}

export function getAccountStatus(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true, emailVerifiedAt: true } });
}

// ─── 비밀번호 재설정 ─────────────────────────────────────────

/** 가입된 활성 계정이면 재설정 링크 토큰을 만든다. 없는 이메일이어도 호출한 쪽은 같은 응답을 준다(가입 여부 노출 방지). */
export async function requestPasswordReset(email: string): Promise<{ raw: string; email: string; name: string } | null> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, email: true, name: true, isActive: true } });
  if (!user || !user.isActive) return null;
  return { raw: await issue(user.id, 'PASSWORD_RESET', PASSWORD_RESET_TTL_MS), email: user.email, name: user.name };
}

export async function resetPassword(raw: string, password: string): Promise<boolean> {
  const userId = await consume(raw, 'PASSWORD_RESET');
  if (!userId) return false;
  // 메일로 받은 링크를 열었으니 이메일 주소도 확인된 셈이다.
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password), emailVerifiedAt: new Date() } });
  await prisma.authToken.updateMany({ where: { userId, type: 'PASSWORD_RESET', usedAt: null }, data: { usedAt: new Date() } });
  return true;
}

// ─── 팀 초대 ────────────────────────────────────────────────

export class InvitationError extends Error {
  constructor(public code: 'email_taken' | 'invalid') {
    super(code);
  }
}

export async function createInvitation(orgId: string, input: { email: string; role: Role; invitedById: string }) {
  const email = input.email.trim().toLowerCase();
  // 이메일은 서비스 전체에서 한 계정에만 쓰인다 — 이미 가입된 주소는 다른 워크스페이스로 초대할 수 없다.
  if (await prisma.user.count({ where: { email } })) throw new InvitationError('email_taken');
  const { raw, hash } = createOneTimeToken();
  await prisma.$transaction([
    prisma.invitation.deleteMany({ where: { organizationId: orgId, email, acceptedAt: null } }),
    prisma.invitation.create({
      data: { organizationId: orgId, email, role: input.role, invitedById: input.invitedById, tokenHash: hash, expiresAt: new Date(Date.now() + INVITATION_TTL_MS) },
    }),
  ]);
  return { raw, email };
}

export async function listPendingInvitations(orgId: string) {
  const rows = await prisma.invitation.findMany({
    where: { organizationId: orgId, acceptedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
  });
  const now = new Date();
  return rows.map((r) => ({ ...r, expiresAt: r.expiresAt.toISOString(), createdAt: r.createdAt.toISOString(), expired: r.expiresAt < now }));
}

export async function revokeInvitation(orgId: string, id: string) {
  const result = await prisma.invitation.deleteMany({ where: { id, organizationId: orgId, acceptedAt: null } });
  return result.count > 0;
}

export async function findInvitation(raw: string) {
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashOneTimeToken(raw) }, include: { organization: { select: { name: true, suspendedAt: true } } } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date() || invitation.organization.suspendedAt) return null;
  return { id: invitation.id, email: invitation.email, role: invitation.role, organizationId: invitation.organizationId, organizationName: invitation.organization.name };
}

/** 초대를 받아들여 계정을 만든다. 초대 메일을 받은 주소이므로 인증된 것으로 본다. */
export async function acceptInvitation(raw: string, input: { name: string; password: string }) {
  const invitation = await findInvitation(raw);
  if (!invitation) throw new InvitationError('invalid');
  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const marked = await tx.invitation.updateMany({ where: { id: invitation.id, acceptedAt: null }, data: { acceptedAt: now } });
      if (marked.count !== 1) throw new InvitationError('invalid');
      return tx.user.create({
        data: {
          organizationId: invitation.organizationId,
          email: invitation.email,
          name: input.name,
          passwordHash,
          role: invitation.role,
          emailVerifiedAt: now,
          termsAcceptedAt: now,
        },
        select: { id: true, email: true },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new InvitationError('email_taken');
    throw e;
  }
}
