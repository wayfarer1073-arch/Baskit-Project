import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { addHoliday, listHolidays } from '@/server/repositories/holiday-repository';

function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateStr;
}

export async function GET() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const holidays = await listHolidays(tenant.orgId);
  return NextResponse.json({ holidays });
}

const postSchema = z.object({
  date: z.string().refine(isValidCalendarDate, '존재하지 않는 날짜입니다.'),
  name: z.string().trim().min(1, '공휴일 이름을 입력하세요.').max(30),
});

export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 추가할 수 있습니다.' }, { status: 403 });

  const body = await request.json();
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });

  const result = await addHoliday(tenant.orgId, parsed.data.date, parsed.data.name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });

  return NextResponse.json({ holiday: result.holiday }, { status: 201 });
}
