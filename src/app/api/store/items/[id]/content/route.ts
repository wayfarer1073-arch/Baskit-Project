import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { setItemContent } from '@/server/repositories/menu-repository';

const schema = z.object({
  contentPerUnit: z.number().positive('양은 0보다 커야 합니다.').max(10_000_000).nullable(),
  contentUnit: z.string().trim().max(10).nullable(),
});

/** 매장 품목 환산 — 레시피에 쓰는 단위로 1단위에 든 양(예: 원두 1봉 = 1000 g). null이면 지운다. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  if (parsed.data.contentPerUnit && !parsed.data.contentUnit) return NextResponse.json({ error: '단위를 입력하세요(예: g, ml).' }, { status: 400 });
  if (!(await setItemContent(tenant.orgId, (await params).id, parsed.data))) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
