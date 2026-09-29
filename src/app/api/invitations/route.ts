import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { forbidViewer, getTenant } from '@/server/tenant';
import { getMessages } from '@/server/i18n';
import { appUrl } from '@/server/mail';
import { limitOrNull } from '@/server/rate-limit';
import { createInvitation, InvitationError, listPendingInvitations } from '@/server/repositories/account-repository';
import { sendInvitationMail } from '@/server/services/account-mail';

const schema = z.object({ email: z.string().trim().email().max(200), role: z.enum(['VIEWER', 'MEMBER', 'ADMIN']) });

export async function GET() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 조회할 수 있습니다.' }, { status: 403 });
  return NextResponse.json({ invitations: await listPendingInvitations(tenant.orgId) });
}

export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 초대할 수 있습니다.' }, { status: 403 });
  const m = await getMessages();
  const limited = limitOrNull(`invite:${tenant.orgId}`, 30, 60 * 60_000, m.account.tooMany);
  if (limited) return limited;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? m.account.failed }, { status: 400 });
  try {
    const invite = await createInvitation(tenant.orgId, { ...parsed.data, invitedById: tenant.userId });
    const [org, inviter] = await Promise.all([
      prisma.organization.findUniqueOrThrow({ where: { id: tenant.orgId }, select: { name: true } }),
      prisma.user.findUniqueOrThrow({ where: { id: tenant.userId }, select: { name: true } }),
    ]);
    const link = `${appUrl(request)}/invite?token=${encodeURIComponent(invite.raw)}`;
    const sent = await sendInvitationMail(m, appUrl(request), { raw: invite.raw, email: invite.email, workspace: org.name, inviter: inviter.name });
    // 메일 서비스가 없거나 발송에 실패해도 관리자가 직접 전달할 수 있도록 링크를 한 번 돌려준다.
    return NextResponse.json({ ok: true, link, mailSent: sent }, { status: 201 });
  } catch (e) {
    if (e instanceof InvitationError && e.code === 'email_taken') return NextResponse.json({ error: m.account.emailTaken }, { status: 409 });
    throw e;
  }
}
