import type { EventType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';
import { defaultScheduleColorFor } from '@/lib/schedule-colors';

const toDateOnly = (date: string) => new Date(`${date}T00:00:00.000Z`);

export interface StoreItemNoteRow {
  /** memo: 제목 없는 품목 메모 / schedule: 이 품목이 연결된 캘린더 일정. */
  kind: 'memo' | 'schedule';
  id: string;
  eventType: EventType;
  title: string | null;
  note: string;
  startDate: string;
  endDate: string;
  color: string | null;
  authorName: string | null;
}

export interface StoreItemNoteInput {
  eventType: EventType;
  title: string | null;
  note: string;
  startDate: string;
  endDate: string;
}

async function assertItem(orgId: string, itemId: string) {
  return prisma.storeItem.findFirst({ where: { id: itemId, organizationId: orgId }, select: { id: true } });
}

/** 품목 상세의 메모/이벤트 — 품목 메모와 이 품목이 들어간 캘린더 일정을 기간이 최근인 순으로. */
export async function listStoreItemNotes(orgId: string, itemId: string): Promise<StoreItemNoteRow[] | null> {
  if (!(await assertItem(orgId, itemId))) return null;
  const [memos, links] = await Promise.all([
    prisma.storeItemMemo.findMany({ where: { storeItemId: itemId, isDeleted: false }, include: { createdBy: { select: { name: true } } } }),
    prisma.scheduleStoreItem.findMany({ where: { storeItemId: itemId, schedule: { organizationId: orgId } }, include: { schedule: true } }),
  ]);
  const rows: StoreItemNoteRow[] = [
    ...memos.map((m) => {
      const start = dateOnlyToString(m.startDate);
      return {
        kind: 'memo' as const,
        id: m.id,
        eventType: m.eventType,
        title: null,
        note: m.note,
        startDate: start,
        endDate: m.endDate ? dateOnlyToString(m.endDate) : start,
        color: null,
        authorName: m.createdBy.name,
      };
    }),
    ...links.map((l) => ({
      kind: 'schedule' as const,
      id: l.schedule.id,
      eventType: l.schedule.eventType,
      title: l.schedule.title,
      note: l.schedule.note,
      startDate: dateOnlyToString(l.schedule.startDate),
      endDate: dateOnlyToString(l.schedule.endDate),
      color: l.schedule.color,
      authorName: null,
    })),
  ];
  return rows.sort((a, b) => b.startDate.localeCompare(a.startDate) || a.kind.localeCompare(b.kind));
}

/**
 * 품목 메모 추가. 제목이 있으면 캘린더 일정이 되고(같은 유형·제목·기간의 일정이 있으면 그 일정에 합류), 없으면 품목에만 남는
 * 메모가 된다 — 일일 재고 SKU의 메모/일정과 같은 규칙.
 */
export async function addStoreItemNote(orgId: string, itemId: string, userId: string, input: StoreItemNoteInput): Promise<boolean> {
  if (!(await assertItem(orgId, itemId))) return false;
  const title = input.title?.trim();
  if (!title) {
    await prisma.storeItemMemo.create({
      data: {
        storeItemId: itemId,
        eventType: input.eventType,
        note: input.note,
        startDate: toDateOnly(input.startDate),
        endDate: input.endDate === input.startDate ? null : toDateOnly(input.endDate),
        createdById: userId,
      },
    });
    return true;
  }
  await prisma.$transaction(async (tx) => {
    const startDate = toDateOnly(input.startDate);
    const endDate = toDateOnly(input.endDate);
    const schedule = await tx.eventSchedule.upsert({
      where: { organizationId_eventType_title_startDate_endDate: { organizationId: orgId, eventType: input.eventType, title, startDate, endDate } },
      create: { organizationId: orgId, eventType: input.eventType, title, startDate, endDate, note: input.note, color: defaultScheduleColorFor(title) },
      update: {},
    });
    await tx.scheduleStoreItem.upsert({
      where: { scheduleId_storeItemId: { scheduleId: schedule.id, storeItemId: itemId } },
      create: { scheduleId: schedule.id, storeItemId: itemId },
      update: {},
    });
  });
  return true;
}

export async function updateStoreItemMemo(orgId: string, itemId: string, memoId: string, input: Omit<StoreItemNoteInput, 'title'>): Promise<boolean> {
  const result = await prisma.storeItemMemo.updateMany({
    where: { id: memoId, storeItemId: itemId, isDeleted: false, storeItem: { organizationId: orgId } },
    data: { eventType: input.eventType, note: input.note, startDate: toDateOnly(input.startDate), endDate: input.endDate === input.startDate ? null : toDateOnly(input.endDate) },
  });
  return result.count > 0;
}

export async function deleteStoreItemMemo(orgId: string, itemId: string, memoId: string): Promise<boolean> {
  const result = await prisma.storeItemMemo.updateMany({ where: { id: memoId, storeItemId: itemId, storeItem: { organizationId: orgId } }, data: { isDeleted: true } });
  return result.count > 0;
}

export class ScheduleClashError extends Error {}

/**
 * 품목 상세에서 연결된 일정을 고친다 — 일정 자체(유형·제목·기간·내용)가 바뀌어 캘린더와 같은 일정의 다른 SKU 메모에도 반영된다.
 */
export async function updateLinkedSchedule(orgId: string, itemId: string, scheduleId: string, userId: string, input: StoreItemNoteInput & { title: string }): Promise<boolean> {
  const link = await prisma.scheduleStoreItem.findFirst({ where: { scheduleId, storeItemId: itemId, schedule: { organizationId: orgId } } });
  if (!link) return false;
  const startDate = toDateOnly(input.startDate);
  const endDate = toDateOnly(input.endDate);
  const title = input.title.trim();
  const clash = await prisma.eventSchedule.findFirst({
    where: { organizationId: orgId, eventType: input.eventType, title, startDate, endDate, NOT: { id: scheduleId } },
    select: { id: true },
  });
  if (clash) throw new ScheduleClashError('같은 카테고리·제목·기간의 일정이 이미 있어요.');
  await prisma.$transaction(async (tx) => {
    await tx.eventSchedule.update({ where: { id: scheduleId }, data: { eventType: input.eventType, title, startDate, endDate, note: input.note } });
    const events = await tx.inventoryEvent.findMany({ where: { scheduleId, isDeleted: false } });
    for (const e of events) {
      await tx.eventHistory.create({
        data: {
          eventId: e.id,
          changeType: 'UPDATE',
          previousData: {
            eventType: e.eventType,
            quantity: e.quantity,
            note: e.note,
            eventDate: e.eventDate.toISOString(),
            endDate: e.endDate ? e.endDate.toISOString() : null,
            title: e.title,
          },
          changedById: userId,
        },
      });
      await tx.inventoryEvent.update({
        where: { id: e.id },
        data: { eventType: input.eventType, title, eventDate: startDate, endDate: input.endDate === input.startDate ? null : endDate },
      });
    }
  });
  return true;
}

/** 품목을 일정에서 뺀다. 캘린더에서 만든 일정이 아니고 남은 연결(SKU 메모·품목)이 없으면 일정도 사라진다. */
export async function unlinkSchedule(orgId: string, itemId: string, scheduleId: string): Promise<boolean> {
  const result = await prisma.scheduleStoreItem.deleteMany({ where: { scheduleId, storeItemId: itemId, schedule: { organizationId: orgId } } });
  if (result.count === 0) return false;
  const schedule = await prisma.eventSchedule.findUnique({
    where: { id: scheduleId },
    select: { managed: true, _count: { select: { storeItems: true, events: { where: { isDeleted: false } } } } },
  });
  if (schedule && !schedule.managed && schedule._count.storeItems === 0 && schedule._count.events === 0) {
    await prisma.eventSchedule.delete({ where: { id: scheduleId } });
  }
  return true;
}
