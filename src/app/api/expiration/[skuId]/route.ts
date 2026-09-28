import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/server/tenant';
import { setExpirationRiskDays } from '@/server/repositories/expiration-repository';

// 소비기한 자체는 로트 단위로 관리한다 (/api/expiration/lots, /api/expiration/lots/[lotId]).
// 위험 판정 일수만 SKU 단위 값이라 이 엔드포인트에 남아 있다.
const patchSchema = z.object({ expirationRiskDays: z.number().int().min(0).nullable() });

export async function PATCH(request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 변경할 수 있습니다.' }, { status: 403 });

  const { skuId } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });

  const ok = await setExpirationRiskDays(tenant.orgId, skuId, parsed.data.expirationRiskDays);
  if (!ok) return NextResponse.json({ error: 'SKU를 찾을 수 없습니다.' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
