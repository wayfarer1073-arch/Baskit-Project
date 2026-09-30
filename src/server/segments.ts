import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getOrganization } from '@/server/repositories/organization-repository';
import { SEGMENT_COOKIE, SEGMENT_META, enabledSegmentsOf, isSegment, resolveSegment, type Segment } from '@/lib/segments';

/** 이 워크스페이스가 쓰는 방식들과, 지금 보고 있는 방식(쿠키 → 기본 방식 → 첫 방식 순). */
export async function getSegmentContext(orgId: string): Promise<{ enabled: Segment[]; active: Segment; orgDefault: Segment }> {
  const organization = await getOrganization(orgId);
  const enabled = enabledSegmentsOf(organization.disabledSegments, organization.segment);
  const remembered = (await cookies()).get(SEGMENT_COOKIE)?.value;
  const active = resolveSegment(isSegment(remembered) ? remembered : null, enabled, organization.segment);
  return { enabled, active, orgDefault: organization.segment };
}

/** 꺼 둔 방식의 화면으로 바로 들어오면 쓰는 방식의 대시보드로 보낸다. */
export async function requireEnabledSegment(orgId: string, segment: Segment): Promise<void> {
  const { enabled, active } = await getSegmentContext(orgId);
  if (!enabled.includes(segment)) redirect(SEGMENT_META[active].dashboardHref);
}
