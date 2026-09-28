import { NextResponse } from 'next/server';
import { getPlatformAdmin, ACT_AS_COOKIE } from '@/server/tenant';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/repositories/platform-repository';
import { SEGMENT_COOKIE } from '@/lib/segments';

/** 운영자가 이 워크스페이스의 화면을 그 워크스페이스 관리자 권한으로 그대로 본다(이후 모든 요청에 적용). */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getPlatformAdmin();
  if (!admin) return NextResponse.json({ error: '운영자만 사용할 수 있습니다.' }, { status: 403 });

  const { id } = await params;
  const target = await prisma.organization.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!target) return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다.' }, { status: 404 });

  await recordAudit(admin.userId, 'workspace.enter', target);
  const res = NextResponse.json({ ok: true });
  if (target.id === admin.homeOrgId) res.cookies.delete(ACT_AS_COOKIE);
  else res.cookies.set(ACT_AS_COOKIE, target.id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 8 });
  // 이전 워크스페이스에서 고른 대시보드 유형이 따라오지 않도록, 들어간 워크스페이스의 기본 방식으로 시작한다.
  res.cookies.delete(SEGMENT_COOKIE);
  return res;
}
