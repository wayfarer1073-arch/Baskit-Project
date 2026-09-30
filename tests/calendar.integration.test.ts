import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase, row } from './db-fixtures';
import { createSnapshot } from '../src/server/repositories/snapshot-repository';
import { createSchedule, deleteSchedule, listSchedules, ScheduleError, updateSchedule, type ScheduleInput } from '../src/server/repositories/schedule-repository';
import { createStoreItem } from '../src/server/repositories/store-repository';
import { setDisabledSegments } from '../src/server/repositories/organization-repository';
import { enabledSegmentsOf } from '../src/lib/segments';

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
  const skus = await prisma.sku.findMany({ where: { warehouseId: f.warehouse.id }, orderBy: { productCode: 'asc' } });
  [skuA, skuB] = skus.map((s) => s.id);
  item = (await createStoreItem(f.org.id, { name: '원두 1kg', unit: '봉', leadTimeDays: 1 }))!.id;
});
afterEach(() => cleanupFixture(f));
afterAll(() => prisma.$disconnect());

const base = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  eventType: 'PROMOTION',
  title: '추석 행사',
  startDate: '2026-10-01',
  endDate: '2026-10-05',
  color: 'lime',
  note: '출고량 증가 예상',
  skuIds: [skuA, item],
  ...over,
});

it('creates a schedule with SKU memos and store items, visible in the calendar', async () => {
  const { id } = await createSchedule(f.org.id, f.user.id, base());
  const [schedule] = await listSchedules(f.org.id);
  expect(schedule).toMatchObject({ id, title: '추석 행사', note: '출고량 증가 예상', color: 'lime', startDate: '2026-10-01', endDate: '2026-10-05' });
  expect(schedule.events.map((e) => [e.skuId, e.isStore]).sort()).toEqual([
    [item, true],
    [skuA, false],
  ].sort());
  expect(schedule.events[0].note).toBe('출고량 증가 예상');
});

it('keeps a calendar schedule with no linked items', async () => {
  await createSchedule(f.org.id, f.user.id, base({ skuIds: [] }));
  expect(await listSchedules(f.org.id)).toHaveLength(1);
});

it('updates members: removed SKU memo is soft-deleted with history, new SKU gets a memo', async () => {
  const { id } = await createSchedule(f.org.id, f.user.id, base());
  const before = await prisma.inventoryEvent.findFirstOrThrow({ where: { scheduleId: id, skuId: skuA } });
  await updateSchedule(f.org.id, f.user.id, id, base({ skuIds: [skuB], note: '바뀐 내용', endDate: '2026-10-03' }));

  const removed = await prisma.inventoryEvent.findUniqueOrThrow({ where: { id: before.id } });
  expect(removed.isDeleted).toBe(true);
  expect(await prisma.eventHistory.count({ where: { eventId: before.id, changeType: 'DELETE' } })).toBe(1);

  const [schedule] = await listSchedules(f.org.id);
  expect(schedule.events.map((e) => [e.skuId, e.note])).toEqual([[skuB, '바뀐 내용']]);
  expect(schedule.endDate).toBe('2026-10-03');
});

it('rejects SKUs from another workspace', async () => {
  const other = await createFixture();
  try {
    await createSnapshot({
      warehouseId: other.warehouse.id,
      snapshotDate: new Date('2026-09-01T00:00:00.000Z'),
      sourceFileName: 'x',
      fileHash: 'x',
      uploadedById: other.user.id,
      rows: [row('Z')],
      replaceExisting: true,
    });
    const foreign = await prisma.sku.findFirstOrThrow({ where: { warehouseId: other.warehouse.id } });
    await expect(createSchedule(f.org.id, f.user.id, base({ skuIds: [foreign.id] }))).rejects.toBeInstanceOf(ScheduleError);
  } finally {
    await cleanupFixture(other);
  }
});

it('deletes a schedule, keeping memo history', async () => {
  const { id } = await createSchedule(f.org.id, f.user.id, base());
  const event = await prisma.inventoryEvent.findFirstOrThrow({ where: { scheduleId: id } });
  await deleteSchedule(f.org.id, f.user.id, id);
  expect(await listSchedules(f.org.id)).toEqual([]);
  expect(await prisma.eventSchedule.count({ where: { id } })).toBe(0);
  const kept = await prisma.inventoryEvent.findUniqueOrThrow({ where: { id: event.id } });
  expect(kept).toMatchObject({ isDeleted: true, scheduleId: null });
});

it('turning dashboards off and on never touches their data', async () => {
  await prisma.dailySales.create({ data: { organizationId: f.org.id, date: new Date('2026-09-01T00:00:00.000Z'), amount: 1000 } });
  const counts = async () => ({
    snapshots: await prisma.inventorySnapshot.count({ where: { warehouseId: f.warehouse.id } }),
    sales: await prisma.dailySales.count({ where: { organizationId: f.org.id } }),
    items: await prisma.sku.count({ where: { warehouse: { organizationId: f.org.id, kind: 'STORE' } } }),
  });
  const initial = await counts();

  const off = await setDisabledSegments(f.org.id, ['ORDER_CYCLE', 'PERIODIC_COUNT']);
  expect(enabledSegmentsOf(off.disabledSegments, 'DAILY_SYNC')).toEqual(['DAILY_SYNC']);
  expect(await counts()).toEqual(initial);

  const on = await setDisabledSegments(f.org.id, []);
  expect(enabledSegmentsOf(on.disabledSegments, 'DAILY_SYNC')).toEqual(['DAILY_SYNC', 'PERIODIC_COUNT', 'ORDER_CYCLE']);
  expect(await counts()).toEqual(initial);
});
