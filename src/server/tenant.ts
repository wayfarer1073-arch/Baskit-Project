import { auth } from '@/server/auth';

export interface Tenant {
  userId: string;
  role: 'MEMBER' | 'ADMIN';
  orgId: string;
  isAdmin: boolean;
}

/** 로그인한 사용자와 소속 조직. 모든 데이터 조회/수정은 이 orgId로 범위를 제한해야 한다. */
export async function getTenant(): Promise<Tenant | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.organizationId) return null;
  return { userId: user.id, role: user.role, orgId: user.organizationId, isAdmin: user.role === 'ADMIN' };
}

/** 서버 컴포넌트용 — (app) 레이아웃이 이미 비로그인 사용자를 걸러내므로 여기서는 없으면 오류로 본다. */
export async function requireTenant(): Promise<Tenant> {
  const tenant = await getTenant();
  if (!tenant) throw new Error('인증된 조직 정보가 없습니다.');
  return tenant;
}
