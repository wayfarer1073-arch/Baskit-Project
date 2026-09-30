import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase, row } from './db-fixtures';
import { createSnapshot } from '../src/server/repositories/snapshot-repository';
import { createSchedule, listSchedules } from '../src/server/repositories/schedule-repository';
import { listEventsForSku, updateEvent } from '../src/server/repositories/event-repository';
import { addStoreItemNote, listStoreItemNotes, unlinkSchedule, updateLinkedSchedule } from '../src/server/repositories/store-memo-repository';

requireTestDatabase();

let f: Awaited<ReturnType<typeof createFixture>>;
let skuA: string;
let skuB: string;
let item: string;

beforeEach(async () => {
  f = await createFixture();
  await createSnapshot({
    warehouseId: f.warehouse.id,
    snapshotDate: new Date('2026-09-01T00:00:00.000Z'),
    sourceFileName: 'a.xlsx',
    fileHash: 'h1',
    uploadedById: f.user.id,
    rows: [row('A'), row('B')],
    replaceExisting: true,
  });
  [skuA, skuB] = (await prisma.sku.findMany({ where: { warehouseId: f.warehouse.id }, orderBy: { productCode: 'asc' } })).map((s) => s.id);
  item = (await prisma.storeItem.create({ data: { organizationId: f.org.id, name: '원두 1kg' } })).id;
});
afterEach(() => cleanupFixture(f));
afterAll(() => prisma.$disconnect());

const schedule = () =>
  createSchedule(f.org.id, f.user.id, {
    eventType: 'PROMOTION',
    title: '추석 행사',
    startDate: '2026-10-01',
    endDate: '2026-10-05',
    color: 'lime',
    note: '출고량 증가 예상',
    skuIds: [skuA, skuB],
    storeItemIds: [item],
  });

it('shows a calendar schedule in every linked SKU and store item', async () => {
  const { id } = await schedule();
  const eventsA = await listEventsForSku(skuA);
  expect(eventsA).toHaveLength(1);
  expect(eventsA[0]).toMatchObject({ scheduleId: id, title: '추석 행사', note: '출고량 증가 예상' });
  const notes = await listStoreItemNotes(f.org.id, item);
  expect(notes).toEqual([expect.objectContaining({ kind: 'schedule', id, title: '추석 행사', startDate: '2026-10-01', endDate: '2026-10-05' })]);
});

it('editing the title or period from one SKU updates the calendar schedule and the other SKU', async () => {
  const { id } = await schedule();
  const eventA = (await listEventsForSku(skuA))[0];
  await updateEvent(f.org.id, eventA.id, f.user.id, {
    eventType: 'PROMOTION',
    quantity: null,
    note: 'A만의 메모',
    eventDate: new Date('2026-10-02T00:00:00.000Z'),
    endDate: new Date('2026-10-06T00:00:00.000Z'),
    title: '추석 대목 행사',
  });
  const updated = await prisma.eventSchedule.findUniqueOrThrow({ where: { id } });
  expect(updated.title).toBe('추석 대목 행사');
  expect(updated.startDate.toISOString().slice(0, 10)).toBe('2026-10-02');
  expect(updated.endDate.toISOString().slice(0, 10)).toBe('2026-10-06');
  const eventB = (await listEventsForSku(skuB))[0];
  expect(eventB).toMatchObject({ scheduleId: id, title: '추석 대목 행사', note: '출고량 증가 예상' }); // 다른 SKU 메모 내용은 그대로
  expect((await listEventsForSku(skuA))[0].note).toBe('A만의 메모');
  expect((await listStoreItemNotes(f.org.id, item))?.[0]).toMatchObject({ title: '추석 대목 행사', startDate: '2026-10-02' });
  // 캘린더에 일정이 하나만 남아 있다(새 일정으로 갈라지지 않음).
  expect((await listSchedules(f.org.id)).map((s) => s.title)).toEqual(['추석 대목 행사']);
});

it('store item notes: titled notes become calendar schedules, plain memos stay on the item, edits flow back', async () => {
  await addStoreItemNote(f.org.id, item, f.user.id, { eventType: 'OTHER', title: null, note: '원두 로스팅 바뀜', startDate: '2026-09-20', endDate: '2026-09-20' });
  await addStoreItemNote(f.org.id, item, f.user.id, { eventType: 'INBOUND', title: '원두 대량 입고', note: '20kg', startDate: '2026-09-25', endDate: '2026-09-25' });
  const notes = (await listStoreItemNotes(f.org.id, item))!;
  expect(notes.map((n) => [n.kind, n.title])).toEqual([
    ['schedule', '원두 대량 입고'],
    ['memo', null],
  ]);
  expect((await listSchedules(f.org.id)).map((s) => s.title)).toEqual(['원두 대량 입고']);

  const scheduleId = notes[0].id;
  await updateLinkedSchedule(f.org.id, item, scheduleId, f.user.id, {
    eventType: 'INBOUND',
    title: '원두 대량 입고(변경)',
    note: '25kg',
    startDate: '2026-09-26',
    endDate: '2026-09-27',
  });
  expect((await listSchedules(f.org.id))[0]).toMatchObject({ title: '원두 대량 입고(변경)', startDate: '2026-09-26', endDate: '2026-09-27' });

  // 품목을 빼면 품목에서 만든 일정(다른 연결 없음)은 캘린더에서도 사라진다.
  expect(await unlinkSchedule(f.org.id, item, scheduleId)).toBe(true);
  expect(await listSchedules(f.org.id)).toEqual([]);

  // 다른 조직은 읽거나 쓸 수 없다.
  const other = await createFixture();
  try {
    expect(await listStoreItemNotes(other.org.id, item)).toBeNull();
    expect(await addStoreItemNote(other.org.id, item, other.user.id, { eventType: 'OTHER', title: null, note: 'x', startDate: '2026-09-20', endDate: '2026-09-20' })).toBe(false);
  } finally {
    await cleanupFixture(other);
  }
});
