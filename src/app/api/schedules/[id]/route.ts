import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { SCHEDULE_COLORS } from '@/lib/schedule-colors';
import { setScheduleColor } from '@/server/repositories/schedule-repository';

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
