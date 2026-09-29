import { NextResponse } from 'next/server';
import { forbidViewer, getTenant } from '@/server/tenant';
import { updateSkuReorder } from '@/server/repositories/reorder-repository';
import { skuReorderSchema } from '@/server/validation/reorder';

/** 품목 발주 기준 예외(거래처와 비워 두면 위 층 값을 쓰는 칸들)를 저장한다. */
export async function PATCH(request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 변경할 수 있습니다.' }, { status: 403 });
  const { skuId } = await params;
  const parsed = skuReorderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값을 확인하세요.' }, { status: 400 });
  if (!(await updateSkuReorder(tenant.orgId, skuId, parsed.data))) return NextResponse.json({ error: '품목 또는 거래처를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
