import { NextResponse } from 'next/server';
import { forbidViewer, getTenant } from '@/server/tenant';
import { deleteImportTemplate, renameImportTemplate } from '@/server/repositories/import-template-repository';
import { templateNameSchema } from '@/server/validation/import-layout';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = templateNameSchema.safeParse(body?.name);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '이름을 확인하세요.' }, { status: 400 });
  if (!(await renameImportTemplate(tenant.orgId, id, parsed.data))) return NextResponse.json({ error: '템플릿을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  const { id } = await params;
  if (!(await deleteImportTemplate(tenant.orgId, id))) return NextResponse.json({ error: '템플릿을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
