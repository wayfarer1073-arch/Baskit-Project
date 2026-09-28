import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { listRecentCountedSkus } from '@/server/repositories/count-repository';

export async function GET(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const warehouseId = new URL(request.url).searchParams.get('warehouseId');
  if (!warehouseId) return NextResponse.json({ error: '창고를 지정하세요.' }, { status: 400 });
  return NextResponse.json({ skus: await listRecentCountedSkus(tenant.orgId, warehouseId) });
}
