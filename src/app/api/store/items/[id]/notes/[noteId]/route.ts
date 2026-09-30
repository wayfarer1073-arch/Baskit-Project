import { NextResponse } from 'next/server';
import { forbidViewer, getTenant } from '@/server/tenant';
import { deleteStoreItemMemo, ScheduleClashError, unlinkSchedule, updateLinkedSchedule, updateStoreItemMemo } from '@/server/repositories/store-memo-repository';
import { storeNoteSchema } from '@/server/validation/store-note';

type Params = { params: Promise<{ id: string; noteId: string }> };

/** ?kind=schedule이면 연결된 캘린더 일정을, 아니면 품목 메모를 고친다. */
export async function PATCH(request: Request, { params }: Params) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  const parsed = storeNoteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  const { id, noteId } = await params;
  const isSchedule = new URL(request.url).searchParams.get('kind') === 'schedule';
  try {
    const ok = isSchedule
      ? parsed.data.title
        ? await updateLinkedSchedule(tenant.orgId, id, noteId, tenant.userId, { ...parsed.data, title: parsed.data.title })
        : false
      : await updateStoreItemMemo(tenant.orgId, id, noteId, parsed.data);
    if (!ok)
      return NextResponse.json(
        { error: isSchedule && !parsed.data.title ? '일정 제목을 입력하세요.' : '메모를 찾을 수 없습니다.' },
        { status: isSchedule && !parsed.data.title ? 400 : 404 },
      );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ScheduleClashError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

/** ?kind=schedule이면 이 품목을 일정에서 빼고, 아니면 품목 메모를 지운다. */
export async function DELETE(request: Request, { params }: Params) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  const { id, noteId } = await params;
  const isSchedule = new URL(request.url).searchParams.get('kind') === 'schedule';
  const ok = isSchedule ? await unlinkSchedule(tenant.orgId, id, noteId) : await deleteStoreItemMemo(tenant.orgId, id, noteId);
  if (!ok) return NextResponse.json({ error: '메모를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
