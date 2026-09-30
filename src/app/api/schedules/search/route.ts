import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { searchScheduleMembers } from '@/server/repositories/schedule-repository';
import { getSegmentContext } from '@/server/segments';

/** 일정에 연결할 재고 SKU·매장 품목 검색 — 켜 둔 방식의 항목만. */
export async function GET(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const { enabled } = await getSegmentContext(tenant.orgId);
  const results = await searchScheduleMembers(tenant.orgId, q, {
    stock: enabled.includes('DAILY_SYNC') || enabled.includes('PERIODIC_COUNT'),
    store: enabled.includes('ORDER_CYCLE'),
  });
  return NextResponse.json({ results });
}
