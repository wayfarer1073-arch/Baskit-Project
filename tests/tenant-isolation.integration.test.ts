import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { createFixture, cleanupFixture, requireTestDatabase, row } from './db-fixtures';
import { createSnapshot } from '../src/server/repositories/snapshot-repository';
import {
  loadActiveSkusWithSeries, loadDailyWarehouseTotals, loadSkuWithSeries, setSkuB2B, SkuNotFoundError,
} from '../src/server/repositories/inventory-repository';
import { addInboundEntry, deleteInboundEntry } from '../src/server/repositories/inbound-repository';
import { createEvent, softDeleteEvent, updateEvent, EventNotFoundError } from '../src/server/repositories/event-repository';
import { addExpirationLot } from '../src/server/repositories/expiration-repository';
import { archiveWarehouse, getWarehouseInOrg } from '../src/server/repositories/warehouse-repository';
import { listSchedules } from '../src/server/repositories/schedule-repository';

requireTestDatabase();
let a: Awaited<ReturnType<typeof createFixture>>;
let b: Awaited<ReturnType<typeof createFixture>>;
beforeEach(async () => { a = await createFixture(); b = await createFixture(); });
afterEach(async () => { await cleanupFixture(a); await cleanupFixture(b); });
afterAll(() => prisma.$disconnect());

async function seedA() {
  await createSnapshot({ warehouseId: a.warehouse.id, uploadedById: a.user.id, snapshotDate: new Date('2026-09-10'),
    sourceFileName: 'a.xlsx', fileHash: 'a', rows: [row('SHARED-CODE', 100)] });
  return prisma.sku.findFirstOrThrow({ where: { warehouseId: a.warehouse.id } });
}

it('never returns another organization\'s inventory, even when its warehouse id is passed', async () => {
  const sku = await seedA();
  expect(await loadActiveSkusWithSeries(a.org.id, undefined, '2026-09-10')).toHaveLength(1);
  expect(await loadActiveSkusWithSeries(b.org.id, undefined, '2026-09-10')).toEqual([]);
  expect(await loadActiveSkusWithSeries(b.org.id, a.warehouse.id, '2026-09-10')).toEqual([]);
  expect(await loadSkuWithSeries(b.org.id, sku.id, '2026-09-10')).toBeNull();
  expect((await loadDailyWarehouseTotals(b.org.id)).some((t) => t.warehouseId === a.warehouse.id)).toBe(false);
  expect(await getWarehouseInOrg(b.org.id, a.warehouse.id)).toBeNull();
});

it('rejects writes that target another organization\'s records', async () => {
  const sku = await seedA();
  await expect(setSkuB2B(b.org.id, sku.id, true)).rejects.toBeInstanceOf(SkuNotFoundError);
  expect((await prisma.sku.findUniqueOrThrow({ where: { id: sku.id } })).isB2B).toBe(false);

  const inbound = await addInboundEntry({ warehouseId: a.warehouse.id, skuId: sku.id, date: '2026-09-11', quantity: 5 });
  expect(inbound.ok).toBe(true);
  if (!inbound.ok) return;
  expect(await deleteInboundEntry(b.org.id, inbound.entry.id)).toBe(false);
  expect(await prisma.snapshotInbound.count({ where: { id: inbound.entry.id } })).toBe(1);

  const event = await createEvent({ organizationId: a.org.id, warehouseId: a.warehouse.id, skuId: sku.id, eventType: 'OTHER',
    quantity: null, note: 'a only', eventDate: new Date('2026-09-10'), createdById: a.user.id });
  const patch = { eventType: 'OTHER' as const, quantity: null, note: 'hijacked', eventDate: new Date('2026-09-10') };
  await expect(updateEvent(b.org.id, event.id, b.user.id, patch)).rejects.toBeInstanceOf(EventNotFoundError);
  await expect(softDeleteEvent(b.org.id, event.id, b.user.id)).rejects.toBeInstanceOf(EventNotFoundError);
  expect((await prisma.inventoryEvent.findUniqueOrThrow({ where: { id: event.id } })).note).toBe('a only');

  expect((await addExpirationLot(b.org.id, sku.id, null, '2027-01-01')).ok).toBe(false);
});

it('keeps same-named calendar schedules separate per organization', async () => {
  await seedA();
  await createSnapshot({ warehouseId: b.warehouse.id, uploadedById: b.user.id, snapshotDate: new Date('2026-09-10'),
    sourceFileName: 'b.xlsx', fileHash: 'b', rows: [row('SHARED-CODE', 100)] });
  for (const f of [a, b]) {
    await createEvent({ organizationId: f.org.id, warehouseId: f.warehouse.id, skuId: null, eventType: 'PROMOTION', quantity: null,
      note: 'promo', eventDate: new Date('2026-09-10'), title: '추석 프로모션', createdById: f.user.id });
  }
  const [schedulesA, schedulesB] = await Promise.all([listSchedules(a.org.id), listSchedules(b.org.id)]);
  expect(schedulesA).toHaveLength(1);
  expect(schedulesB).toHaveLength(1);
  expect(schedulesA[0].id).not.toBe(schedulesB[0].id);
  expect(schedulesA[0].events.every((e) => e.warehouseId === a.warehouse.id)).toBe(true);
});

it('hides archived warehouses from analysis without deleting their history', async () => {
  await seedA();
  expect(await archiveWarehouse(a.org.id, a.warehouse.id)).toBe(true);
  expect(await loadActiveSkusWithSeries(a.org.id, undefined, '2026-09-10')).toEqual([]);
  expect(await prisma.inventorySnapshot.count({ where: { warehouseId: a.warehouse.id } })).toBe(1);
});
