import { redirect } from 'next/navigation';
import { requireTenant } from '@/server/tenant';
import { getSegmentContext } from '@/server/segments';
import { SEGMENT_META } from '@/lib/segments';

/** 루트는 마지막으로 고른 대시보드로 보낸다 (없거나 꺼져 있으면 기본 방식 → 쓰는 방식 중 첫 번째). */
export default async function HomePage() {
  const tenant = await requireTenant();
  const { active } = await getSegmentContext(tenant.orgId);
  redirect(SEGMENT_META[active].dashboardHref);
}
