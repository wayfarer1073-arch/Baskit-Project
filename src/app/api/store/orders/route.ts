import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { addPurchaseOrders } from '@/server/repositories/store-repository';
import { isDateString, todayKstDateString } from '@/lib/date';

const schema = z.object({
  date: z.string().refine(isDateString, '날짜를 확인하세요.'),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        quantity: z.number().positive('발주 수량은 0보다 커야 합니다.').max(1_000_000),
        coverageAmount: z.number().int('충족 매출은 원 단위 정수로 입력하세요.').positive('충족 매출은 0보다 커야 합니다.').max(100_000_000_000).nullable(),
        leftoverQuantity: z.number().min(0, '잔량은 0 이상이어야 합니다.').max(1_000_000).nullable().default(null),
      }),
    )
    .min(1, '발주할 품목을 하나 이상 입력하세요.')
    .max(50),
});

/** 같은 날짜의 발주를 여러 품목 한 번에 기록한다. */
export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  if (parsed.data.date > todayKstDateString()) return NextResponse.json({ error: '미래 날짜로는 발주를 기록할 수 없습니다.' }, { status: 400 });

  const count = await addPurchaseOrders(tenant.orgId, { ...parsed.data, createdById: tenant.userId });
  if (count === null) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true, count }, { status: 201 });
}
