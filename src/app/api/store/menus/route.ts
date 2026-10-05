import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { createMenu, MenuNameTakenError } from '@/server/repositories/menu-repository';

const schema = z.object({ name: z.string().trim().min(1, '메뉴 이름을 입력하세요.').max(100), code: z.string().trim().max(50).nullable().default(null) });

export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  try {
    const menu = await createMenu(tenant.orgId, parsed.data);
    return NextResponse.json({ id: menu.id }, { status: 201 });
  } catch (e) {
    if (e instanceof MenuNameTakenError) return NextResponse.json({ error: '같은 이름의 메뉴가 이미 있습니다.' }, { status: 409 });
    throw e;
  }
}
