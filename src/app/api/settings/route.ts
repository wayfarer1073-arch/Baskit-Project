import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/server/tenant';
import { updateSettings } from '@/server/repositories/settings-repository';

const schema = z.object({
  stockoutSoonDays: z.number().int().min(1).max(365),
  manageMaxDays: z.number().int().min(1).max(365),
  overstockCoverageDays: z.number().int().min(1).max(1000),
  stagnantDays: z.number().int().min(1).max(365),
});

export async function PATCH(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 변경할 수 있습니다.' }, { status: 403 });

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });

  const settings = await updateSettings(tenant.orgId, parsed.data);
  return NextResponse.json({ settings });
}
