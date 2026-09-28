import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { deletePurchaseOrder } from '@/server/repositories/store-repository';

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { id } = await params;
  const ok = await deletePurchaseOrder(tenant.orgId, id);
  if (!ok) return NextResponse.json({ error: '발주 기록을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
