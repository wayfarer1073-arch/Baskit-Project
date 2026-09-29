import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { setSkuUnitCost } from '@/server/repositories/cost-repository';

const schema = z.object({ unitCost: z.number().min(0).max(1_000_000_000_000).nullable() });

/** 설정 > 원가 관리에서 품목 원가를 직접 정하거나(숫자) 지운다(null). */
export async function PUT(request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 변경할 수 있습니다.' }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '원가는 0 이상의 숫자로 입력하세요.' }, { status: 400 });
  const { skuId } = await params;
  const cost = parsed.data.unitCost === null ? null : Math.round(parsed.data.unitCost * 100) / 100;
  if (!(await setSkuUnitCost(tenant.orgId, skuId, cost))) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
