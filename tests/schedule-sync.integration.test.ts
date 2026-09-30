import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase, row } from './db-fixtures';
import { createSnapshot } from '../src/server/repositories/snapshot-repository';
import { createSchedule, listSchedules } from '../src/server/repositories/schedule-repository';
import { createEvent, listEventsForSku, updateEvent } from '../src/server/repositories/event-repository';
import { createStoreItem } from '../src/server/repositories/store-repository';

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
  item = (await createStoreItem(f.org.id, { name: '원두 1kg', unit: '봉', leadTimeDays: 1 }))!.id;
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
    skuIds: [skuA, skuB, item],
  });

it('shows a calendar schedule in every linked SKU and store item', async () => {
  const { id } = await schedule();
  const eventsA = await listEventsForSku(skuA);
  expect(eventsA).toHaveLength(1);
  expect(eventsA[0]).toMatchObject({ scheduleId: id, title: '추석 행사', note: '출고량 증가 예상' });
  // 매장 품목도 가상 창고의 SKU라 같은 메모/이벤트로 보인다.
  expect(await listEventsForSku(item)).toEqual([expect.objectContaining({ scheduleId: id, title: '추석 행사', note: '출고량 증가 예상' })]);
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
  expect((await listEventsForSku(item))[0]).toMatchObject({ scheduleId: id, title: '추석 대목 행사' });
  // 캘린더에 일정이 하나만 남아 있다(새 일정으로 갈라지지 않음).
  expect((await listSchedules(f.org.id)).map((s) => s.title)).toEqual(['추석 대목 행사']);
});

it('a titled memo on a store item becomes a calendar schedule; a plain memo stays on the item', async () => {
  const storeWarehouseId = (await prisma.sku.findUniqueOrThrow({ where: { id: item } })).warehouseId;
  const memo = { organizationId: f.org.id, warehouseId: storeWarehouseId, skuId: item, quantity: null, createdById: f.user.id };
  await createEvent({ ...memo, eventType: 'OTHER', note: '원두 로스팅 바뀜', eventDate: new Date('2026-09-20T00:00:00.000Z') });
  await createEvent({ ...memo, eventType: 'INBOUND', note: '20kg', title: '원두 대량 입고', eventDate: new Date('2026-09-25T00:00:00.000Z') });

  const events = await listEventsForSku(item);
  expect(events.map((e) => [e.title, e.scheduleId !== null]).sort()).toEqual([
    ['원두 대량 입고', true],
    [null, false],
  ].sort());
  const [calendar] = await listSchedules(f.org.id);
  expect(calendar).toMatchObject({ title: '원두 대량 입고', startDate: '2026-09-25' });
  expect(calendar.events).toEqual([expect.objectContaining({ skuId: item, isStore: true })]);
});
