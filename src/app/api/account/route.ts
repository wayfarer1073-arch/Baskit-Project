import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getTenant } from '@/server/tenant';
import { clientIp, limitOrNull } from '@/server/rate-limit';
import { countActiveAdmins, deleteUser } from '@/server/repositories/user-repository';

const schema = z.object({ password: z.string().min(1).max(200) });

/** 본인 탈퇴. 비밀번호를 다시 확인하고, 워크스페이스의 마지막 관리자는 워크스페이스 삭제로 안내한다. */
export async function DELETE(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (tenant.actingAs) return NextResponse.json({ error: '운영자 모드에서는 탈퇴할 수 없습니다.' }, { status: 400 });
  const limited = limitOrNull(`withdraw:${clientIp(request)}`, 10, 15 * 60_000, '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.');
  if (limited) return limited;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '비밀번호를 입력하세요.' }, { status: 400 });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: tenant.userId }, select: { passwordHash: true, role: true, isPlatformAdmin: true } });
  if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) return NextResponse.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 400 });
  if (user.isPlatformAdmin) return NextResponse.json({ error: '서비스 운영자 계정은 여기서 탈퇴할 수 없습니다.' }, { status: 400 });
  if (user.role === 'ADMIN' && (await countActiveAdmins(tenant.orgId)) <= 1) {
    return NextResponse.json({ error: '마지막 관리자는 탈퇴할 수 없어요. 다른 사람을 관리자로 지정하거나 워크스페이스를 삭제하세요.' }, { status: 400 });
  }
  const result = await deleteUser(tenant.userId);
  return NextResponse.json({ ok: true, mode: result.mode });
}
