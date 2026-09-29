import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { countActiveAdmins, deleteUser, getUserRole } from '@/server/repositories/user-repository';

// 계정 삭제는 관리자 권한 전용 기능이다.
export async function DELETE(_: Request, { params }: { params: Promise<{ userId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 삭제할 수 있습니다.' }, { status: 403 });

  const { userId } = await params;
  if (userId === tenant.userId) return NextResponse.json({ error: '본인 계정은 삭제할 수 없습니다.' }, { status: 400 });

  const target = await getUserRole(tenant.orgId, userId);
  if (!target || !target.isActive) return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });

  if (target.role === 'ADMIN') {
    const activeAdmins = await countActiveAdmins(tenant.orgId);
    if (activeAdmins <= 1) return NextResponse.json({ error: '마지막 관리자 계정은 삭제할 수 없습니다.' }, { status: 400 });
  }

  await deleteUser(userId);
  return NextResponse.json({ ok: true });
}
