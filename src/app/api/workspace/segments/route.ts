import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { setDisabledSegments } from '@/server/repositories/organization-repository';
import { SEGMENT_ORDER } from '@/lib/segments';

const schema = z.object({ disabled: z.array(z.enum(['DAILY_SYNC', 'PERIODIC_COUNT', 'ORDER_CYCLE'])) });

/** 쓰는 대시보드 방식 켜기/끄기. 최소 하나는 켜 두어야 하고, 끈 방식의 데이터는 그대로 남는다. */
export async function PUT(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 변경할 수 있습니다.' }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });
  if (SEGMENT_ORDER.every((s) => parsed.data.disabled.includes(s))) {
    return NextResponse.json({ error: '대시보드는 하나 이상 켜 두어야 합니다.' }, { status: 400 });
  }
  const result = await setDisabledSegments(tenant.orgId, parsed.data.disabled);
  return NextResponse.json(result);
}
