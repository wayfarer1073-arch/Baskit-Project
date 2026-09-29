import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { prisma } from '@/lib/prisma';
import { createEvent, findSimilarSchedule, listEventsForSku, listEventsForWarehouse } from '@/server/repositories/event-repository';
import { isSkuInOrg } from '@/server/repositories/inventory-repository';
import { getWarehouseInOrg } from '@/server/repositories/warehouse-repository';

const createEventSchema = z.object({
  warehouseId: z.string().min(1),
  skuId: z.string().min(1).nullable(),
  eventType: z.enum(['INBOUND', 'RETURN', 'ADJUSTMENT', 'PROMOTION', 'SOLD_OUT', 'OTHER']),
  quantity: z.number().int().nullable().optional(),
  note: z.string().min(1, '내용을 입력하세요.'),
  eventDate: z.string().min(1),
  // 기간(시작일~종료일) 선택 시 종료일. 하루짜리 이벤트면 생략하거나 null.
  endDate: z.string().min(1).nullable().optional(),
  // 입력하면 같은 유형·제목·기간의 다른 SKU 이벤트와 캘린더 일정으로 묶인다.
  title: z.string().trim().min(1).nullable().optional(),
  // 유사 일정 확인(needsConfirmation) 후 사용자의 선택을 실어 재요청할 때 쓴다.
  confirmChoice: z.enum(['use_existing', 'create_new']).optional(),
  existingScheduleId: z.string().min(1).optional(),
});

export async function GET(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const url = new URL(request.url);
  const skuId = url.searchParams.get('skuId');
  const warehouseId = url.searchParams.get('warehouseId');

  if (skuId) {
    if (!(await isSkuInOrg(tenant.orgId, skuId))) return NextResponse.json({ error: 'SKU를 찾을 수 없습니다.' }, { status: 404 });
    const events = await listEventsForSku(skuId);
    return NextResponse.json({ events });
  }
  if (warehouseId) {
    if (!(await getWarehouseInOrg(tenant.orgId, warehouseId))) return NextResponse.json({ error: '창고를 찾을 수 없습니다.' }, { status: 404 });
    const events = await listEventsForWarehouse(warehouseId);
    return NextResponse.json({ events });
  }
  return NextResponse.json({ error: 'skuId 또는 warehouseId가 필요합니다.' }, { status: 400 });
}

export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const body = await request.json();
  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '입력값이 올바르지 않습니다.', issues: parsed.error.issues }, { status: 400 });
  }

  if (!(await getWarehouseInOrg(tenant.orgId, parsed.data.warehouseId))) {
    return NextResponse.json({ error: '창고를 찾을 수 없습니다.' }, { status: 404 });
  }
  if (parsed.data.skuId) {
    const sku = await prisma.sku.findUnique({ where: { id: parsed.data.skuId }, select: { warehouseId: true, isActive: true } });
    if (!sku || !sku.isActive || sku.warehouseId !== parsed.data.warehouseId) {
      return NextResponse.json({ error: '현재 관리 중인 SKU가 아니거나 지정한 창고에 속하지 않습니다.' }, { status: 400 });
    }
  }

  const trimmedTitle = parsed.data.title?.trim() || null;
  const eventDate = new Date(parsed.data.eventDate);
  const endDate = parsed.data.endDate ? new Date(parsed.data.endDate) : null;

  // 제목이 있고 아직 사용자에게 확인을 받지 않았다면(재요청이 아니라면), 같은 유형·기간에
  // 제목만 비슷한(완전히 같지는 않은) 기존 일정이 있는지 먼저 확인한다. 있으면 이벤트를 만들지
  // 않고 확인이 필요하다고만 응답한다 — 화면에서 사용자가 예/아니오를 고르면 그 선택을 실어
  // 다시 요청한다.
  if (trimmedTitle && !parsed.data.confirmChoice) {
    const similar = await findSimilarSchedule(tenant.orgId, parsed.data.eventType, trimmedTitle, eventDate, endDate);
    if (similar) {
      return NextResponse.json({ needsConfirmation: true, candidate: similar });
    }
  }

  const event = await createEvent({
    organizationId: tenant.orgId,
    warehouseId: parsed.data.warehouseId,
    skuId: parsed.data.skuId,
    eventType: parsed.data.eventType,
    quantity: parsed.data.quantity ?? null,
    note: parsed.data.note,
    eventDate,
    endDate,
    title: trimmedTitle,
    attachToScheduleId: parsed.data.confirmChoice === 'use_existing' ? parsed.data.existingScheduleId : undefined,
    createdById: tenant.userId,
  });

  return NextResponse.json({ event }, { status: 201 });
}
