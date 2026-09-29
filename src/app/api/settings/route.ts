import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/server/tenant';
import { updateSegmentSettings, updateSettings } from '@/server/repositories/settings-repository';
import { updateReorderDefaults } from '@/server/repositories/reorder-repository';

/** 세그먼트별 설정 탭이 자기 항목만 보내므로 모든 항목은 선택이다. */
const schema = z
  .object({
    stockoutSoonDays: z.number().int().min(1).max(365),
    manageMaxDays: z.number().int().min(1).max(365),
    overstockCoverageDays: z.number().int().min(1).max(1000),
    stagnantDays: z.number().int().min(1).max(365),
    periodicRecountDays: z.number().int().min(1).max(365),
    storeCheckRemainingPct: z.number().int().min(5).max(80),
    allowNonWorkingDayUploads: z.boolean(),
    reorderLeadTimeDays: z.number().int().min(0).max(365),
    reorderSafetyDays: z.number().int().min(0).max(365),
    reorderTargetDays: z.number().int().min(1).max(365),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0);

export async function PATCH(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 변경할 수 있습니다.' }, { status: 403 });

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });

  const { periodicRecountDays, storeCheckRemainingPct, allowNonWorkingDayUploads, reorderLeadTimeDays, reorderSafetyDays, reorderTargetDays, ...risk } = parsed.data;
  if (Object.keys(risk).length > 0) await updateSettings(tenant.orgId, risk);
  const segment = Object.fromEntries(Object.entries({ periodicRecountDays, storeCheckRemainingPct, allowNonWorkingDayUploads }).filter(([, v]) => v !== undefined));
  if (Object.keys(segment).length > 0) await updateSegmentSettings(tenant.orgId, segment);
  const reorder = Object.fromEntries(Object.entries({ reorderLeadTimeDays, reorderSafetyDays, reorderTargetDays }).filter(([, v]) => v !== undefined));
  if (Object.keys(reorder).length > 0) await updateReorderDefaults(tenant.orgId, reorder);
  return NextResponse.json({ ok: true });
}
