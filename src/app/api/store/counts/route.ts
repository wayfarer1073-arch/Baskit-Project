import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { saveEasyCount } from '@/server/repositories/store-repository';
import { isDateString, todayKstDateString } from '@/lib/date';

const schema = z.object({
  date: z.string().refine(isDateString, '날짜를 확인하세요.'),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        /** 미개봉 완제품 개수. 비우면(null) 0개로 본다 — 잔량도 비우면 이 날짜 기록을 지운다. */
        fullUnits: z.number().min(0, '개수는 0 이상이어야 합니다.').max(1_000_000).nullable(),
        openedPercent: z.number().int('잔량은 정수(%)로 입력하세요.').min(0, '잔량은 0~100% 사이여야 합니다.').max(100, '잔량은 0~100% 사이여야 합니다.').nullable(),
      }),
    )
    .min(1, '기록할 품목을 하나 이상 입력하세요.')
    .max(500),
});

/** Easy Count — 한 날짜의 매장 재고(EA·개봉품 잔량)를 여러 품목 한 번에 저장한다. */
export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  if (parsed.data.date > todayKstDateString()) return NextResponse.json({ error: '미래 날짜로는 재고를 기록할 수 없습니다.' }, { status: 400 });

  const result = await saveEasyCount(tenant.orgId, { ...parsed.data, createdById: tenant.userId });
  if (!result) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true, ...result });
}
