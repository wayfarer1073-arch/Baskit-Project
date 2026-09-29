import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/lib/prisma';

/** 운영자가 다른 워크스페이스를 "들어가서" 볼 때 대상 조직 id를 담는 쿠키. 운영자에게만 효력이 있다. */
export const ACT_AS_COOKIE = 'limenote_act_as';

/** 로그인 세션은 있지만 이용이 막힌 사용자를 보내는 곳(미들웨어가 이 경우엔 /로 되돌리지 않는다). */
export const BLOCKED_LOGIN_PATH = '/login?reason=blocked';

export interface Tenant {
  userId: string;
  role: 'VIEWER' | 'MEMBER' | 'ADMIN';
  /** 지금 보고 있는 조직. 운영자가 다른 워크스페이스에 들어가 있으면 그 조직이다. */
  orgId: string;
  isAdmin: boolean;
  isPlatformAdmin: boolean;
  /** 사용자가 실제로 소속된 조직. */
  homeOrgId: string;
  /** 운영자가 자기 소속이 아닌 워크스페이스를 보고 있는지. */
  actingAs: boolean;
}

/**
 * 로그인한 사용자와 조직. 모든 데이터 조회/수정은 이 orgId로 범위를 제한해야 한다.
 *
 * 토큰 내용만 믿지 않고 요청마다 DB로 다시 확인한다 — 비활성화된 계정, 정지된 워크스페이스는
 * 이미 발급된 세션이 있어도 즉시 막히고, 운영자 권한도 토큰이 아니라 DB 값으로만 판단한다.
 * 같은 요청 안에서는 한 번만 조회한다(React cache).
 */
export const getTenant = cache(async (): Promise<Tenant | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, role: true, organizationId: true, isPlatformAdmin: true, organization: { select: { suspendedAt: true } } },
  });
  if (!user || !user.isActive) return null;

  if (user.isPlatformAdmin) {
    const actAs = (await cookies()).get(ACT_AS_COOKIE)?.value;
    if (actAs && actAs !== user.organizationId) {
      const target = await prisma.organization.findUnique({ where: { id: actAs }, select: { id: true } });
      if (target) {
        return { userId, role: 'ADMIN', orgId: target.id, isAdmin: true, isPlatformAdmin: true, homeOrgId: user.organizationId, actingAs: true };
      }
    }
  } else if (user.organization.suspendedAt) {
    return null;
  }

  return {
    userId,
    role: user.role,
    orgId: user.organizationId,
    isAdmin: user.role === 'ADMIN',
    isPlatformAdmin: user.isPlatformAdmin,
    homeOrgId: user.organizationId,
    actingAs: false,
  };
});

/** 서버 컴포넌트용. 비활성화·정지 등으로 막힌 사용자는 안내 문구가 있는 로그인 화면으로 보낸다. */
export async function requireTenant(): Promise<Tenant> {
  const tenant = await getTenant();
  if (!tenant) redirect(BLOCKED_LOGIN_PATH);
  return tenant;
}

/** 운영자 전용 API/페이지 가드. 운영자가 아니면 null. */
export async function getPlatformAdmin(): Promise<Tenant | null> {
  const tenant = await getTenant();
  return tenant?.isPlatformAdmin ? tenant : null;
}

/** 조회 전용(VIEWER) 사용자는 데이터를 바꾸는 요청을 할 수 없다. 막아야 하면 403 응답을, 아니면 null. */
export function forbidViewer(tenant: Tenant): Response | null {
  if (tenant.role !== 'VIEWER') return null;
  return Response.json({ error: '조회 전용 계정은 변경할 수 없습니다.' }, { status: 403 });
}
