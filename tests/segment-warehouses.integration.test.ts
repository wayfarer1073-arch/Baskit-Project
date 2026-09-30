import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase, row } from './db-fixtures';
import { createSnapshot } from '../src/server/repositories/snapshot-repository';
import { createWarehouse, ensureSegmentWarehouse, listWarehouses } from '../src/server/repositories/warehouse-repository';
import { loadActiveSkusWithSeries } from '../src/server/repositories/inventory-repository';
import { loadCountedSkus } from '../src/server/repositories/count-repository';
import { listRegisteredCosts } from '../src/server/repositories/cost-repository';

requireTestDatabase();

let f: Awaited<ReturnType<typeof createFixture>>;
beforeEach(async () => {
  f = await createFixture(); // 기본 창고는 일일 재고 연동
});
afterEach(() => cleanupFixture(f));
afterAll(() => prisma.$disconnect());

const upload = (warehouseId: string, code: string) =>
  createSnapshot({ warehouseId, snapshotDate: new Date('2026-09-29T00:00:00.000Z'), sourceFileName: 'a.xlsx', fileHash: code, uploadedById: f.user.id, rows: [row(code, 10, { unitCost: 500 })] });

it('keeps daily-sync and periodic-count warehouses, their stock and costs apart', async () => {
  const periodic = await createWarehouse(f.org.id, '본사 창고', 'PERIODIC_COUNT');
  await upload(f.warehouse.id, 'D1');
  await upload(periodic.id, 'P1');

  expect((await listWarehouses(f.org.id, 'DAILY_SYNC')).map((w) => w.id)).toEqual([f.warehouse.id]);
  expect((await listWarehouses(f.org.id, 'PERIODIC_COUNT')).map((w) => w.id)).toEqual([periodic.id]);

  const daily = await loadActiveSkusWithSeries(f.org.id, undefined, '2026-09-30');
  expect(daily.map((s) => s.descriptor.productCode)).toEqual(['D1']);
  const counted = await loadCountedSkus(f.org.id, '2026-09-30');
  expect(counted.map((s) => s.descriptor.productCode)).toEqual(['P1']);

  expect((await listRegisteredCosts(f.org.id, 'DAILY_SYNC')).map((c) => c.productCode)).toEqual(['D1']);
  expect((await listRegisteredCosts(f.org.id, 'PERIODIC_COUNT')).map((c) => c.productCode)).toEqual(['P1']);
});

it('creates a default warehouse for a mode that has none, only once', async () => {
  await ensureSegmentWarehouse(f.org.id, 'PERIODIC_COUNT', '기본 창고');
  await ensureSegmentWarehouse(f.org.id, 'PERIODIC_COUNT', '기본 창고');
  expect(await listWarehouses(f.org.id, 'PERIODIC_COUNT')).toHaveLength(1);
  await ensureSegmentWarehouse(f.org.id, 'DAILY_SYNC', '기본 창고');
  expect(await listWarehouses(f.org.id, 'DAILY_SYNC')).toHaveLength(1);
});
