import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { searchSkusInWarehouse } from '@/server/repositories/inventory-repository';
import { getWarehouseInOrg } from '@/server/repositories/warehouse-repository';

export async function GET(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const url = new URL(request.url);
  const warehouseId = url.searchParams.get('warehouseId');
  const q = url.searchParams.get('q') ?? '';
  if (!warehouseId) return NextResponse.json({ error: 'warehouseId가 필요합니다.' }, { status: 400 });

  if (!(await getWarehouseInOrg(tenant.orgId, warehouseId))) return NextResponse.json({ error: '창고를 찾을 수 없습니다.' }, { status: 404 });

  const results = await searchSkusInWarehouse(warehouseId, q);
  return NextResponse.json({ results });
}
