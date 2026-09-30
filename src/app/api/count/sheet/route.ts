import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { loadCountSheet } from '@/server/repositories/count-repository';

/** 직접 입력 화면의 재고 현황 — 창고·날짜별로 상품마다 그날 기록값과 직전 실사. */
export async function GET(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const warehouseId = params.get('warehouseId');
  const date = params.get('date');
  if (!warehouseId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: '창고와 날짜를 지정하세요.' }, { status: 400 });
  const rows = await loadCountSheet(tenant.orgId, warehouseId, date);
  if (!rows) return NextResponse.json({ error: '창고를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ rows });
}
