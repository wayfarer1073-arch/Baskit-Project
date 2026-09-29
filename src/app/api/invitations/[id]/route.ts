import { NextResponse } from 'next/server';
import { forbidViewer, getTenant } from '@/server/tenant';
import { revokeInvitation } from '@/server/repositories/account-repository';

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 취소할 수 있습니다.' }, { status: 403 });
  const { id } = await params;
  if (!(await revokeInvitation(tenant.orgId, id))) return NextResponse.json({ error: '초대를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
