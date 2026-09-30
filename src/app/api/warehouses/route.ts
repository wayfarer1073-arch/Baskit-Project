import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { createWarehouse, listWarehouses } from '@/server/repositories/warehouse-repository';

const MAX_WAREHOUSES = 20;
const schema = z.object({
  name: z.string().trim().min(1, '창고 이름을 입력하세요.').max(50),
  /** 이 창고를 쓰는 방식. 설정의 일일 재고 연동·비정기 실사 탭에서 각각 추가한다. */
  segment: z.enum(['DAILY_SYNC', 'PERIODIC_COUNT']).default('DAILY_SYNC'),
});

export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 추가할 수 있습니다.' }, { status: 403 });

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });

  const existing = await listWarehouses(tenant.orgId);
  if (existing.length >= MAX_WAREHOUSES) {
    return NextResponse.json({ error: `창고는 최대 ${MAX_WAREHOUSES}개까지 등록할 수 있습니다.` }, { status: 400 });
  }

  const warehouse = await createWarehouse(tenant.orgId, parsed.data.name, parsed.data.segment);
  return NextResponse.json({ warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name } }, { status: 201 });
}
