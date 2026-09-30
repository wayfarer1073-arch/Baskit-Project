import { NextResponse } from 'next/server';
import { forbidViewer, getTenant } from '@/server/tenant';
import { addStoreItemNote, listStoreItemNotes } from '@/server/repositories/store-memo-repository';
import { storeNoteSchema } from '@/server/validation/store-note';

/** 매장 품목 상세의 메모/이벤트 — 품목 메모 + 이 품목이 들어간 캘린더 일정. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { id } = await params;
  const notes = await listStoreItemNotes(tenant.orgId, id);
  if (!notes) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ notes });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  const parsed = storeNoteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  const { id } = await params;
  if (!(await addStoreItemNote(tenant.orgId, id, tenant.userId, parsed.data))) return NextResponse.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
