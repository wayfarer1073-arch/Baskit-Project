import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/server/tenant';
import { listInboundEntriesForDate, addInboundEntry } from '@/server/repositories/inbound-repository';
import { todayKstDateString } from '@/lib/date';
import { getWarehouseInOrg } from '@/server/repositories/warehouse-repository';

function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateStr;
}

export async function GET(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const url = new URL(request.url);
  const warehouseId = url.searchParams.get('warehouseId');
  const date = url.searchParams.get('date');
  if (!warehouseId || !date || !isValidCalendarDate(date)) {
    return NextResponse.json({ error: 'warehouseId와 date가 필요합니다.' }, { status: 400 });
  }

  if (!(await getWarehouseInOrg(tenant.orgId, warehouseId))) return NextResponse.json({ error: '창고를 찾을 수 없습니다.' }, { status: 404 });

  const entries = await listInboundEntriesForDate(warehouseId, date);
  return NextResponse.json({ entries });
}

const postSchema = z.object({
  warehouseId: z.string().min(1),
  skuId: z.string().min(1),
  date: z.string().refine(isValidCalendarDate, '존재하지 않는 날짜입니다.'),
  quantity: z.number().int().positive().max(2_147_483_647),
});

export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const body = await request.json();
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });

  if (parsed.data.date > todayKstDateString()) {
    return NextResponse.json({ error: '미래 날짜는 입고일로 선택할 수 없습니다.' }, { status: 400 });
  }

  if (!(await getWarehouseInOrg(tenant.orgId, parsed.data.warehouseId))) return NextResponse.json({ error: '창고를 찾을 수 없습니다.' }, { status: 404 });
  const result = await addInboundEntry(parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ entry: result.entry }, { status: 201 });
}
