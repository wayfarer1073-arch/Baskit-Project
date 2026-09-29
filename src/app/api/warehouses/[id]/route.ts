import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { archiveWarehouse, listWarehouses, renameWarehouse } from '@/server/repositories/warehouse-repository';

const schema = z.object({ name: z.string().trim().min(1).max(50) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 변경할 수 있습니다.' }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '창고명을 확인하세요.' }, { status: 400 });

  const ok = await renameWarehouse(tenant.orgId, id, parsed.data.name);
  if (!ok) return NextResponse.json({ error: '창고를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** 스냅샷·이벤트 이력이 남아 있어 실제 삭제 대신 보관 처리한다. 마지막 남은 창고는 보관할 수 없다. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 변경할 수 있습니다.' }, { status: 403 });

  const { id } = await params;
  const warehouses = await listWarehouses(tenant.orgId);
  if (!warehouses.some((w) => w.id === id)) return NextResponse.json({ error: '창고를 찾을 수 없습니다.' }, { status: 404 });
  if (warehouses.length <= 1) return NextResponse.json({ error: '창고가 최소 하나는 있어야 합니다.' }, { status: 400 });

  await archiveWarehouse(tenant.orgId, id);
  return NextResponse.json({ ok: true });
}
