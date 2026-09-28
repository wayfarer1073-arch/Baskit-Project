import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { getStoreItemDetail } from '@/server/services/store-service';
import { isDateString, todayKstDateString } from '@/lib/date';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { id } = await params;
  const asOf = new URL(request.url).searchParams.get('asOf');
  const today = todayKstDateString();
  const asOfDate = isDateString(asOf) && asOf <= today ? asOf : today;
  const detail = await getStoreItemDetail(tenant.orgId, id, asOfDate);
  if (!detail) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json(detail);
}
