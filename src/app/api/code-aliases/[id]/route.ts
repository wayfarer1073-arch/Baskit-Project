import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { deleteCodeAlias } from '@/server/repositories/code-alias-repository';

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { id } = await params;
  if (!(await deleteCodeAlias(tenant.orgId, id))) return NextResponse.json({ error: '연결을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
