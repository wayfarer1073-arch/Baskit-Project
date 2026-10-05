import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { setRecipe } from '@/server/repositories/menu-repository';

const schema = z.object({
  lines: z.array(z.object({ itemId: z.string().min(1), quantity: z.number().positive('양은 0보다 커야 합니다.').max(1_000_000) })).max(50),
});

/** 메뉴 레시피를 통째로 저장한다(메뉴 1개에 드는 품목과 양). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  const result = await setRecipe(tenant.orgId, (await params).id, parsed.data.lines);
  if (result === 'not_found') return NextResponse.json({ error: '메뉴를 찾을 수 없습니다.' }, { status: 404 });
  if (result === 'bad_item') return NextResponse.json({ error: '품목을 확인하세요(같은 품목은 한 번만).' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
