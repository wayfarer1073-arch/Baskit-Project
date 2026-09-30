import { NextResponse } from 'next/server';
import { forbidViewer, getTenant } from '@/server/tenant';
import { createSchedule, listSchedules, ScheduleError } from '@/server/repositories/schedule-repository';
import { scheduleSchema } from '@/server/validation/schedule';

export async function GET() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const schedules = await listSchedules(tenant.orgId);
  return NextResponse.json({ schedules });
}

/** 캘린더 패널에서 일정 등록 — 카테고리·기간·연결 항목·상세 내용·색상. */
export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const parsed = scheduleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  try {
    const { id } = await createSchedule(tenant.orgId, tenant.userId, parsed.data);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    if (e instanceof ScheduleError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
