import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { deleteSupplier, SupplierNameTakenError, updateSupplier } from '@/server/repositories/store-repository';
import { supplierSchema } from '@/server/validation/store';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { id } = await params;
  const parsed = supplierSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });

  try {
    const ok = await updateSupplier(tenant.orgId, id, parsed.data);
    if (!ok) return NextResponse.json({ error: '발주처를 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof SupplierNameTakenError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { id } = await params;
  const ok = await deleteSupplier(tenant.orgId, id);
  if (!ok) return NextResponse.json({ error: '발주처를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
