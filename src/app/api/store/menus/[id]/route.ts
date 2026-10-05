import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { archiveMenu, MenuNameTakenError, updateMenu } from '@/server/repositories/menu-repository';

const schema = z.object({ name: z.string().trim().min(1, '메뉴 이름을 입력하세요.').max(100).optional(), code: z.string().trim().max(50).nullable().optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  try {
    if (!(await updateMenu(tenant.orgId, (await params).id, parsed.data))) return NextResponse.json({ error: '메뉴를 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof MenuNameTakenError) return NextResponse.json({ error: '같은 이름의 메뉴가 이미 있습니다.' }, { status: 409 });
    throw e;
  }
}

/** 메뉴 보관 — 판매 기록은 남긴다. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!(await archiveMenu(tenant.orgId, (await params).id))) return NextResponse.json({ error: '메뉴를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
