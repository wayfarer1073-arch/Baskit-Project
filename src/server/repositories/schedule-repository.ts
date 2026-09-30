import { Prisma, type EventType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';
import { isScheduleColor, type ScheduleColor } from '@/lib/schedule-colors';
import type { ScheduleRow } from '@/domain/events/schedule-types';

export type { ScheduleRow, ScheduleEventRow, ScheduleStoreItemRow } from '@/domain/events/schedule-types';

const toDateOnly = (date: string) => new Date(`${date}T00:00:00.000Z`);

/**
 * 캘린더에 표시할 전체 일정 목록. 캘린더 패널에서 만든 일정은 연결 항목이 없어도 보이고, 예전 방식(SKU 메모에
 * 제목을 붙여 묶은 일정)은 남은 메모가 있을 때만 보인다 — 같은 제목·기간으로 다시 등록되면 남아있던 색상을
 * 그대로 재사용하기 위해 행 자체는 지우지 않는다.
 */
export async function listSchedules(orgId: string): Promise<ScheduleRow[]> {
  const schedules = await prisma.eventSchedule.findMany({
    where: { organizationId: orgId },
    orderBy: { startDate: 'asc' },
    include: {
      events: {
        where: { isDeleted: false },
        include: {
          sku: { select: { productCode: true, currentProductName: true } },
          warehouse: { select: { code: true, name: true } },
        },
      },
      storeItems: { include: { storeItem: { select: { name: true, unit: true } } } },
    },
  });

  return schedules
    .filter((s) => s.managed || s.events.length > 0 || s.storeItems.length > 0)
    .map((s) => ({
      id: s.id,
      eventType: s.eventType,
      title: s.title,
      startDate: dateOnlyToString(s.startDate),
      endDate: dateOnlyToString(s.endDate),
      color: s.color,
      note: s.note,
      events: s.events.map((e) => ({
        id: e.id,
        skuId: e.skuId,
        warehouseId: e.warehouseId,
        warehouseCode: e.warehouse.code,
        warehouseName: e.warehouse.name,
        productCode: e.sku?.productCode ?? null,
        productName: e.sku?.currentProductName ?? null,
        note: e.note,
        quantity: e.quantity,
      })),
      storeItems: s.storeItems.map((i) => ({ storeItemId: i.storeItemId, name: i.storeItem.name, unit: i.storeItem.unit })),
    }));
}

export type SetScheduleColorResult = { ok: true } | { ok: false; error: string };

export async function setScheduleColor(orgId: string, id: string, color: string): Promise<SetScheduleColorResult> {
  if (!isScheduleColor(color)) return { ok: false, error: '허용되지 않는 색상입니다.' };
  const result = await prisma.eventSchedule.updateMany({ where: { id, organizationId: orgId }, data: { color: color satisfies ScheduleColor } });
  if (result.count === 0) return { ok: false, error: '일정을 찾을 수 없습니다.' };
  return { ok: true };
}

export interface ScheduleInput {
  eventType: EventType;
  title: string;
  startDate: string;
  endDate: string;
  color: ScheduleColor;
  note: string;
  /** 재고 SKU(일일 재고 연동·비정기 실사) — SKU마다 메모(InventoryEvent)를 만들어 SKU 상세에도 보이게 한다. */
  skuIds: string[];
  /** 매장 품목(매장 발주 예측). */
  storeItemIds: string[];
}

export class ScheduleError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;

async function resolveMembers(tx: Tx, orgId: string, input: ScheduleInput) {
  const skuIds = [...new Set(input.skuIds)];
  const storeItemIds = [...new Set(input.storeItemIds)];
  const skus = await tx.sku.findMany({ where: { id: { in: skuIds }, warehouse: { organizationId: orgId } }, select: { id: true, warehouseId: true } });
  if (skus.length !== skuIds.length) throw new ScheduleError('선택한 SKU를 찾을 수 없습니다.', 400);
  const items = await tx.storeItem.findMany({ where: { id: { in: storeItemIds }, organizationId: orgId }, select: { id: true } });
  if (items.length !== storeItemIds.length) throw new ScheduleError('선택한 매장 품목을 찾을 수 없습니다.', 400);
  return { skus, storeItemIds };
}

function eventFields(input: ScheduleInput) {
  return {
    eventType: input.eventType,
    note: input.note,
    eventDate: toDateOnly(input.startDate),
    endDate: input.endDate === input.startDate ? null : toDateOnly(input.endDate),
    title: input.title,
  };
}

function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** 캘린더 패널에서 일정 등록 — 일정 한 줄 + SKU마다 메모 + 매장 품목 연결을 한 번에 만든다. */
export async function createSchedule(orgId: string, userId: string, input: ScheduleInput): Promise<{ id: string }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const { skus, storeItemIds } = await resolveMembers(tx, orgId, input);
      const schedule = await tx.eventSchedule.create({
        data: {
          organizationId: orgId,
          eventType: input.eventType,
          title: input.title,
          startDate: toDateOnly(input.startDate),
          endDate: toDateOnly(input.endDate),
          color: input.color,
          note: input.note,
          managed: true,
        },
      });
      const fields = eventFields(input);
      for (const sku of skus) {
        await tx.inventoryEvent.create({ data: { ...fields, warehouseId: sku.warehouseId, skuId: sku.id, scheduleId: schedule.id, createdById: userId } });
      }
      if (storeItemIds.length) await tx.scheduleStoreItem.createMany({ data: storeItemIds.map((storeItemId) => ({ scheduleId: schedule.id, storeItemId })) });
      return { id: schedule.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ScheduleError('같은 카테고리·제목·기간의 일정이 이미 있어요.', 409);
    throw e;
  }
}

async function recordHistory(tx: Tx, eventId: string, changeType: 'UPDATE' | 'DELETE', changedById: string) {
  const existing = await tx.inventoryEvent.findUniqueOrThrow({ where: { id: eventId } });
  await tx.eventHistory.create({
    data: {
      eventId,
      changeType,
      previousData: {
        eventType: existing.eventType,
        quantity: existing.quantity,
        note: existing.note,
        eventDate: existing.eventDate.toISOString(),
        endDate: existing.endDate ? existing.endDate.toISOString() : null,
        title: existing.title,
      },
      changedById,
    },
  });
}

/**
 * 일정 수정 — 빠진 SKU의 메모는 지우고(이력 보존), 남은 SKU 메모는 새 내용·기간으로 고치고, 새로 고른 SKU에는
 * 메모를 만든다. 매장 품목 연결은 통째로 바꾼다. 창고 전체 메모(SKU 없음)는 건드리지 않는다.
 */
export async function updateSchedule(orgId: string, userId: string, id: string, input: ScheduleInput): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const schedule = await tx.eventSchedule.findFirst({ where: { id, organizationId: orgId } });
      if (!schedule) throw new ScheduleError('일정을 찾을 수 없습니다.', 404);
      const { skus, storeItemIds } = await resolveMembers(tx, orgId, input);
      await tx.eventSchedule.update({
        where: { id },
        data: {
          eventType: input.eventType,
          title: input.title,
          startDate: toDateOnly(input.startDate),
          endDate: toDateOnly(input.endDate),
          color: input.color,
          note: input.note,
          managed: true,
        },
      });
      const fields = eventFields(input);
      const current = await tx.inventoryEvent.findMany({ where: { scheduleId: id, isDeleted: false, skuId: { not: null } }, select: { id: true, skuId: true } });
      const wanted = new Map(skus.map((s) => [s.id, s]));
      for (const event of current) {
        if (event.skuId && wanted.has(event.skuId)) {
          await recordHistory(tx, event.id, 'UPDATE', userId);
          await tx.inventoryEvent.update({ where: { id: event.id }, data: fields });
          wanted.delete(event.skuId);
        } else {
          await recordHistory(tx, event.id, 'DELETE', userId);
          await tx.inventoryEvent.update({ where: { id: event.id }, data: { isDeleted: true } });
        }
      }
      for (const sku of wanted.values()) {
        await tx.inventoryEvent.create({ data: { ...fields, warehouseId: sku.warehouseId, skuId: sku.id, scheduleId: id, createdById: userId } });
      }
      await tx.scheduleStoreItem.deleteMany({ where: { scheduleId: id } });
      if (storeItemIds.length) await tx.scheduleStoreItem.createMany({ data: storeItemIds.map((storeItemId) => ({ scheduleId: id, storeItemId })) });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ScheduleError('같은 카테고리·제목·기간의 일정이 이미 있어요.', 409);
    throw e;
  }
}

/** 일정 삭제 — 연결된 SKU 메모는 지움 표시(이력 보존) 후 일정과의 연결을 끊고, 일정 행과 품목 연결을 지운다. */
export async function deleteSchedule(orgId: string, userId: string, id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const schedule = await tx.eventSchedule.findFirst({ where: { id, organizationId: orgId } });
    if (!schedule) throw new ScheduleError('일정을 찾을 수 없습니다.', 404);
    const events = await tx.inventoryEvent.findMany({ where: { scheduleId: id }, select: { id: true, isDeleted: true } });
    for (const event of events) {
      if (!event.isDeleted) await recordHistory(tx, event.id, 'DELETE', userId);
    }
    await tx.inventoryEvent.updateMany({ where: { scheduleId: id }, data: { isDeleted: true, scheduleId: null } });
    await tx.eventSchedule.delete({ where: { id } });
  });
}

export interface ScheduleMemberOption {
  kind: 'sku' | 'store';
  id: string;
  name: string;
  /** 재고 SKU의 상품코드(매장 품목은 null). */
  code: string | null;
  /** 재고 SKU가 속한 창고(매장 품목은 null). */
  warehouseCode: string | null;
  warehouseName: string | null;
}

/**
 * 일정에 연결할 항목 검색 — 재고 SKU(보관하지 않은 창고)와 매장 품목을 한 번에 찾는다.
 * 켜 둔 방식의 항목만 찾는다(재고 SKU는 일일 재고 연동·비정기 실사, 매장 품목은 매장 발주 예측).
 */
export async function searchScheduleMembers(orgId: string, query: string, opts: { stock: boolean; store: boolean }, limit = 20): Promise<ScheduleMemberOption[]> {
  const q = query.trim();
  if (!q) return [];
  const results: ScheduleMemberOption[] = [];
  if (opts.stock) {
    const skus = await prisma.sku.findMany({
      where: {
        warehouse: { organizationId: orgId, isArchived: false },
        isHiddenFromDashboard: false,
        OR: [{ productCode: { contains: q, mode: 'insensitive' } }, { currentProductName: { contains: q, mode: 'insensitive' } }],
      },
      select: { id: true, productCode: true, currentProductName: true, warehouse: { select: { code: true, name: true } } },
      orderBy: [{ isActive: 'desc' }, { productCode: 'asc' }],
      take: limit,
    });
    for (const s of skus)
      results.push({ kind: 'sku', id: s.id, name: s.currentProductName, code: s.productCode, warehouseCode: s.warehouse.code, warehouseName: s.warehouse.name });
  }
  if (opts.store) {
    const items = await prisma.storeItem.findMany({
      where: { organizationId: orgId, isArchived: false, name: { contains: q, mode: 'insensitive' } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: limit,
    });
    for (const i of items) results.push({ kind: 'store', id: i.id, name: i.name, code: null, warehouseCode: null, warehouseName: null });
  }
  return results;
}
