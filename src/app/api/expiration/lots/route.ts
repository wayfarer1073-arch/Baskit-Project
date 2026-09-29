import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { addExpirationLot } from '@/server/repositories/expiration-repository';

function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateStr;
}

const postSchema = z.object({
  skuId: z.string().min(1),
  lot: z.string().trim().min(1).nullable().optional(),
  expirationDate: z.string().refine(isValidCalendarDate, '존재하지 않는 날짜입니다.'),
});

/** 소비기한 관리 화면에서 로트 하나를 수동으로 추가한다. lot을 비우면 소비기한 순으로 A/B/C…가 자동 배정된다. */
export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 추가할 수 있습니다.' }, { status: 403 });

  const body = await request.json();
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });

  const result = await addExpirationLot(tenant.orgId, parsed.data.skuId, parsed.data.lot ?? null, parsed.data.expirationDate);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, lotId: result.lotId });
}
