import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/server/tenant';
import { deleteDailySales, upsertDailySales } from '@/server/repositories/store-repository';
import { isDateString, todayKstDateString } from '@/lib/date';

const schema = z.object({
  date: z.string().refine(isDateString, '날짜를 확인하세요.'),
  amount: z.number().int('매출은 원 단위 정수로 입력하세요.').min(0).max(100_000_000_000),
});

/** 같은 날짜를 다시 저장하면 덮어쓴다. */
export async function PUT(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  if (parsed.data.date > todayKstDateString()) return NextResponse.json({ error: '미래 날짜의 매출은 기록할 수 없습니다.' }, { status: 400 });

  await upsertDailySales(tenant.orgId, parsed.data.date, parsed.data.amount);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const date = new URL(request.url).searchParams.get('date');
  if (!isDateString(date)) return NextResponse.json({ error: '날짜를 확인하세요.' }, { status: 400 });
  const ok = await deleteDailySales(tenant.orgId, date);
  if (!ok) return NextResponse.json({ error: '해당 날짜의 매출 기록이 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
