import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getTenant } from '@/server/tenant';
import { clientIp, limitOrNull } from '@/server/rate-limit';
import { deleteWorkspace } from '@/server/repositories/platform-repository';

const schema = z.object({ confirmName: z.string().min(1).max(100), password: z.string().min(1).max(200) });

/** 관리자의 워크스페이스 해지 — 워크스페이스 이름과 본인 비밀번호를 다시 확인하고 모든 데이터를 지운다. 되돌릴 수 없다. */
export async function DELETE(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!tenant.isAdmin || tenant.actingAs) return NextResponse.json({ error: '워크스페이스 관리자만 삭제할 수 있습니다.' }, { status: 403 });
  const limited = limitOrNull(`workspace-delete:${clientIp(request)}`, 5, 15 * 60_000, '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.');
  if (limited) return limited;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '워크스페이스 이름과 비밀번호를 입력하세요.' }, { status: 400 });

  const [org, user, operators] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: tenant.orgId }, select: { name: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: tenant.userId }, select: { passwordHash: true } }),
    prisma.user.count({ where: { organizationId: tenant.orgId, isPlatformAdmin: true } }),
  ]);
  if (parsed.data.confirmName.trim() !== org.name) return NextResponse.json({ error: '워크스페이스 이름이 일치하지 않습니다.' }, { status: 400 });
  if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) return NextResponse.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 400 });
  // 운영자 계정이 속한 워크스페이스는 지우지 않는다(운영자 계정까지 사라지므로).
  if (operators > 0) return NextResponse.json({ error: '서비스 운영자 계정이 속한 워크스페이스는 삭제할 수 없습니다.' }, { status: 400 });

  await deleteWorkspace(tenant.orgId);
  console.info(`[workspace] deleted by its admin: ${tenant.orgId}`);
  return NextResponse.json({ ok: true });
}
