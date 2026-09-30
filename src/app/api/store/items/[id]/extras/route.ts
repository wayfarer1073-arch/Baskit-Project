import { NextResponse } from 'next/server';
import { forbidViewer, getTenant } from '@/server/tenant';
import { updateStoreItemExtras } from '@/server/repositories/store-repository';
import { storeItemExtrasSchema } from '@/server/validation/store';

/** 매장 품목의 원가·규격·보관 방법·바코드·입수량·메모·소비기한 임박 기준을 저장한다(관리자). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 변경할 수 있습니다.' }, { status: 403 });

  const { id } = await params;
  const parsed = storeItemExtrasSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });

  const ok = await updateStoreItemExtras(tenant.orgId, id, parsed.data);
  if (!ok) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
