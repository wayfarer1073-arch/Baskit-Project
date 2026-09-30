import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { SCHEDULE_COLORS } from '@/lib/schedule-colors';
import { deleteSchedule, ScheduleError, setScheduleColor, updateSchedule } from '@/server/repositories/schedule-repository';
import { scheduleSchema } from '@/server/validation/schedule';

const patchSchema = z.object({ color: z.enum(SCHEDULE_COLORS) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const { id } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });

  const result = await setScheduleColor(tenant.orgId, id, parsed.data.color);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });

  return NextResponse.json({ ok: true });
}

/** 일정 전체 수정(카테고리·기간·연결 항목·내용·색상). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const { id } = await params;
  const parsed = scheduleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  try {
    await updateSchedule(tenant.orgId, tenant.userId, id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ScheduleError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const { id } = await params;
  try {
    await deleteSchedule(tenant.orgId, tenant.userId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ScheduleError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
