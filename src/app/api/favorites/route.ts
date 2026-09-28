import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { listFavoriteSkuIds } from '@/server/repositories/favorite-repository';

export async function GET() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const skuIds = await listFavoriteSkuIds(tenant.userId);
  return NextResponse.json({ skuIds });
}
