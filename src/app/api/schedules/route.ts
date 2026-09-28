import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { listSchedules } from '@/server/repositories/schedule-repository';

export async function GET() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const schedules = await listSchedules(tenant.orgId);
  return NextResponse.json({ schedules });
}
