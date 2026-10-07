import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { deleteHoliday, renameHoliday } from '@/server/repositories/holiday-repository';

export async function DELETE(_: Request, { params }: { params: Promise<{ holidayId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 삭제할 수 있습니다.' }, { status: 403 });

  const { holidayId } = await params;
  const ok = await deleteHoliday(tenant.orgId, holidayId);
  if (!ok) return NextResponse.json({ error: '공휴일을 찾을 수 없습니다.' }, { status: 404 });

  return NextResponse.json({ ok: true });
}

const patchSchema = z.object({ name: z.string().trim().min(1, '휴무 사유를 입력하세요.').max(30) });

/** 휴무 사유 바꾸기. */
export async function PATCH(request: Request, { params }: { params: Promise<{ holidayId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 바꿀 수 있습니다.' }, { status: 403 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  const { holidayId } = await params;
  const holiday = await renameHoliday(tenant.orgId, holidayId, parsed.data.name);
  if (!holiday) return NextResponse.json({ error: '휴무일을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ holiday });
}
