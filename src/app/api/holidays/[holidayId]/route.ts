import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { deleteHoliday } from '@/server/repositories/holiday-repository';

export async function DELETE(_: Request, { params }: { params: Promise<{ holidayId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 삭제할 수 있습니다.' }, { status: 403 });

  const { holidayId } = await params;
  const ok = await deleteHoliday(tenant.orgId, holidayId);
  if (!ok) return NextResponse.json({ error: '공휴일을 찾을 수 없습니다.' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
