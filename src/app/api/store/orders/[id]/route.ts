import { NextResponse } from 'next/server';
import { forbidViewer, getTenant } from '@/server/tenant';
import { z } from 'zod';
import { isDateString } from '@/lib/date';
import { deletePurchaseOrder, setOrderExpiration } from '@/server/repositories/store-repository';

const patchSchema = z.object({ expirationDate: z.string().refine(isDateString, '소비기한 날짜를 확인하세요.').nullable() });

/** 기록한 발주의 소비기한을 나중에 적거나 고친다(null이면 지운다). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  const result = await setOrderExpiration(tenant.orgId, id, parsed.data.expirationDate);
  if (result === 'not_found') return NextResponse.json({ error: '발주 기록을 찾을 수 없습니다.' }, { status: 404 });
  if (result === 'before_order') return NextResponse.json({ error: '소비기한은 발주일과 같거나 그 뒤여야 합니다.' }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const { id } = await params;
  const ok = await deletePurchaseOrder(tenant.orgId, id);
  if (!ok) return NextResponse.json({ error: '발주 기록을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
