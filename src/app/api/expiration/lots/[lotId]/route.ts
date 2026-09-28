import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/server/tenant';
import { updateExpirationLot, deleteExpirationLot } from '@/server/repositories/expiration-repository';

function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateStr;
}

// lot과 expirationDate는 서로 다른 값이라 하나씩 보낼 수 있다(둘 다 보내도 됨). lot을 null/빈 문자열로
// 보내면 자동 배정(A/B/C…)으로 되돌린다.
const patchSchema = z
  .object({
    lot: z.string().trim().nullable().optional(),
    expirationDate: z.string().refine(isValidCalendarDate, '존재하지 않는 날짜입니다.').optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: '변경할 값이 없습니다.' });

export async function PATCH(request: Request, { params }: { params: Promise<{ lotId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 변경할 수 있습니다.' }, { status: 403 });

  const { lotId } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });

  const result = await updateExpirationLot(tenant.orgId, lotId, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ lotId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 삭제할 수 있습니다.' }, { status: 403 });

  const { lotId } = await params;
  const ok = await deleteExpirationLot(tenant.orgId, lotId);
  if (!ok) return NextResponse.json({ error: '로트를 찾을 수 없습니다.' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
