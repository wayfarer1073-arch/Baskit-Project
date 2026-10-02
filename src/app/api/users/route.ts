import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { listUsers } from '@/server/repositories/user-repository';

/** 워크스페이스 사용자 목록. 새 사용자는 '팀 초대'로만 들어온다(관리자가 직접 계정을 만들지 않는다). */
export async function GET() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 조회할 수 있습니다.' }, { status: 403 });

  const users = await listUsers(tenant.orgId);
  return NextResponse.json({ users });
}
