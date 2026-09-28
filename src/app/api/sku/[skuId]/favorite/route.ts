import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { addFavorite, removeFavorite } from '@/server/repositories/favorite-repository';

// 즐겨찾기는 개인 설정이라 관리자 권한이 필요 없다 — 로그인한 사용자라면 누구나 자신의 목록을 관리한다.
export async function POST(_: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { skuId } = await params;
  const added = await addFavorite(tenant.orgId, tenant.userId, skuId);
  if (!added) return NextResponse.json({ error: 'SKU를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { skuId } = await params;
  await removeFavorite(tenant.userId, skuId);
  return NextResponse.json({ ok: true });
}
