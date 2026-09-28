import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireTenant } from '@/server/tenant';
import { getOrganization } from '@/server/repositories/organization-repository';
import { SEGMENT_COOKIE, SEGMENT_META, isSegment } from '@/lib/segments';

/** 루트는 마지막으로 고른 대시보드로 보낸다 (없으면 가입 때 고른 관리 방식). */
export default async function HomePage() {
  const tenant = await requireTenant();
  const remembered = (await cookies()).get(SEGMENT_COOKIE)?.value;
  const segment = isSegment(remembered) ? remembered : (await getOrganization(tenant.orgId)).segment;
  redirect(SEGMENT_META[segment].dashboardHref);
}
