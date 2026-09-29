import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { EventNotFoundError, findSimilarSchedule, softDeleteEvent, updateEvent } from '@/server/repositories/event-repository';

// 수정 화면은 항상 이벤트 전체 값을 다시 보내므로(부분 patch가 아니라 편집 폼의 최종 상태),
// 생성(POST /api/events)과 같은 형태의 스키마를 쓴다 — 유사 일정 확인 흐름도 그대로 재사용한다.
const updateEventSchema = z.object({
  eventType: z.enum(['INBOUND', 'RETURN', 'ADJUSTMENT', 'PROMOTION', 'SOLD_OUT', 'OTHER']),
  quantity: z.number().int().nullable().optional(),
  note: z.string().min(1, '내용을 입력하세요.'),
  eventDate: z.string().min(1),
  endDate: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).nullable().optional(),
  confirmChoice: z.enum(['use_existing', 'create_new']).optional(),
  existingScheduleId: z.string().min(1).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const { id } = await params;
  const body = await request.json();
  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });
  }

  const trimmedTitle = parsed.data.title?.trim() || null;
  const eventDate = new Date(parsed.data.eventDate);
  const endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null;

  if (trimmedTitle && !parsed.data.confirmChoice) {
    const similar = await findSimilarSchedule(tenant.orgId, parsed.data.eventType, trimmedTitle, eventDate, endDate);
    if (similar) {
      return NextResponse.json({ needsConfirmation: true, candidate: similar });
    }
  }

  try {
    await updateEvent(tenant.orgId, id, tenant.userId, {
      eventType: parsed.data.eventType,
      quantity: parsed.data.quantity ?? null,
      note: parsed.data.note,
      eventDate,
      endDate,
      title: trimmedTitle,
      attachToScheduleId: parsed.data.confirmChoice === 'use_existing' ? parsed.data.existingScheduleId : undefined,
    });
  } catch (e) {
    if (e instanceof EventNotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const { id } = await params;
  try {
    await softDeleteEvent(tenant.orgId, id, tenant.userId);
  } catch (e) {
    if (e instanceof EventNotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }

  return NextResponse.json({ ok: true });
}
