import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { deleteInboundEntry } from '@/server/repositories/inbound-repository';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { id } = await params;
  const deleted = await deleteInboundEntry(tenant.orgId, id);
  if (!deleted) return NextResponse.json({ error: '입고 기록을 찾을 수 없습니다.' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
