import { NextResponse } from 'next/server';
import { forbidViewer, getTenant } from '@/server/tenant';
import { recordCounts } from '@/server/repositories/count-repository';
import { countSchema } from '@/server/validation/count';
import { todayKstDateString } from '@/lib/date';
import { nonWorkingDayRejection } from '@/server/services/input-day-policy';

/** 직접 센 수량을 그 날짜의 실사로 기록한다(같은 날 기존 실사와 합쳐짐). */
export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const parsed = countSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  if (parsed.data.date > todayKstDateString()) return NextResponse.json({ error: '미래 날짜로는 실사를 기록할 수 없습니다.' }, { status: 400 });
  const dayRejection = await nonWorkingDayRejection(tenant.orgId, parsed.data.date);
  if (dayRejection) return NextResponse.json({ error: dayRejection }, { status: 400 });

  const snapshot = await recordCounts(tenant.orgId, { ...parsed.data, userId: tenant.userId });
  if (!snapshot) return NextResponse.json({ error: '창고를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true, count: parsed.data.lines.length }, { status: 201 });
}
