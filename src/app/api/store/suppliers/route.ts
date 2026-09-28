import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { createSupplier, SupplierNameTakenError } from '@/server/repositories/store-repository';
import { supplierSchema } from '@/server/validation/store';

export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const parsed = supplierSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });

  try {
    const supplier = await createSupplier(tenant.orgId, parsed.data);
    return NextResponse.json({ supplier: { id: supplier.id, name: supplier.name } }, { status: 201 });
  } catch (e) {
    if (e instanceof SupplierNameTakenError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
