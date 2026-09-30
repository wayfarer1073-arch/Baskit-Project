import { NextResponse } from 'next/server';
import { forbidViewer, getTenant } from '@/server/tenant';
import { createStoreItem, StoreItemNameTakenError } from '@/server/repositories/store-repository';
import { storeItemSchema } from '@/server/validation/store';

export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const parsed = storeItemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });

  try {
    const item = await createStoreItem(tenant.orgId, parsed.data);
    if (!item) return NextResponse.json({ error: '발주처를 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ item: { id: item.id, name: item.currentProductName } }, { status: 201 });
  } catch (e) {
    if (e instanceof StoreItemNameTakenError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
