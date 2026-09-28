import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { getPeriodicSkuDetail } from '@/server/services/periodic-service';
import { isDateString, todayKstDateString } from '@/lib/date';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { id } = await params;
  const asOf = new URL(request.url).searchParams.get('asOf');
  const today = todayKstDateString();
  const detail = await getPeriodicSkuDetail(tenant.orgId, id, isDateString(asOf) && asOf <= today ? asOf : today);
  if (!detail) return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json(detail);
}
