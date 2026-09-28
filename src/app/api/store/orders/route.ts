import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/server/tenant';
import { addPurchaseOrder } from '@/server/repositories/store-repository';
import { isDateString, todayKstDateString } from '@/lib/date';

const schema = z.object({
  itemId: z.string().min(1),
  date: z.string().refine(isDateString, '날짜를 확인하세요.'),
  quantity: z.number().positive('발주 수량은 0보다 커야 합니다.').max(1_000_000),
});

export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  if (parsed.data.date > todayKstDateString()) return NextResponse.json({ error: '미래 날짜로는 발주를 기록할 수 없습니다.' }, { status: 400 });

  const order = await addPurchaseOrder(tenant.orgId, { ...parsed.data, createdById: tenant.userId });
  if (!order) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true, id: order.id }, { status: 201 });
}
