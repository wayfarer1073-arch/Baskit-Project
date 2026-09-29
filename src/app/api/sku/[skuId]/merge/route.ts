import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { MergeLinkError, setSkuMerge } from '@/server/repositories/merge-repository';

const schema = z.object({ targetSkuId: z.string().min(1).nullable() });

/** 다른 창고의 품목과 같은 품목으로 묶거나(targetSkuId) 묶음을 푼다(null). */
export async function PUT(request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 변경할 수 있습니다.' }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '묶을 품목을 고르세요.' }, { status: 400 });
  const { skuId } = await params;
  try {
    if (!(await setSkuMerge(tenant.orgId, skuId, parsed.data.targetSkuId))) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });
  } catch (e) {
    if (e instanceof MergeLinkError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
