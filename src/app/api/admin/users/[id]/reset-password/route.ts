import { NextResponse } from 'next/server';
import { getPlatformAdmin } from '@/server/tenant';
import { getUserForAdmin, recordAudit, resetUserPassword } from '@/server/repositories/platform-repository';

/** 로그인을 못 하는 사용자를 돕기 위한 임시 비밀번호 발급. 응답으로 한 번만 보여준다. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getPlatformAdmin();
  if (!admin) return NextResponse.json({ error: '운영자만 사용할 수 있습니다.' }, { status: 403 });

  const { id } = await params;
  const user = await getUserForAdmin(id);
  if (!user) return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
  if (user.isPlatformAdmin) return NextResponse.json({ error: '운영자 계정은 콘솔에서 바꿀 수 없습니다.' }, { status: 400 });

  const tempPassword = await resetUserPassword(id);
  await recordAudit(admin.userId, 'user.reset_password', { id: user.organizationId, name: user.organization.name }, { email: user.email });
  return NextResponse.json({ tempPassword });
}
