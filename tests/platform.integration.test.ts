import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { createFixture, cleanupFixture, requireTestDatabase, row } from './db-fixtures';
import { createSnapshot } from '../src/server/repositories/snapshot-repository';
import { createDemoWorkspace } from '../src/server/demo/demo-workspace';
import { computePlatformMetrics, deleteWorkspace, listWorkspaceSummaries } from '../src/server/repositories/platform-repository';
import { loadActiveSkusWithSeries } from '../src/server/repositories/inventory-repository';
import { getPeriodicRows } from '../src/server/services/periodic-service';
import { getStoreDashboard } from '../src/server/services/store-service';
import { todayKstDateString } from '../src/lib/date';

requireTestDatabase();
let fixture: Awaited<ReturnType<typeof createFixture>>;
const demos: string[] = [];
beforeEach(async () => { fixture = await createFixture(); });
afterEach(async () => {
  for (const id of demos.splice(0)) await deleteWorkspace(id).catch(() => undefined);
  await cleanupFixture(fixture);
});
afterAll(() => prisma.$disconnect());

it('creates demo workspaces whose data drives each segment dashboard', async () => {
  const today = todayKstDateString();
  const daily = await createDemoWorkspace('DAILY_SYNC', fixture.user.id);
  const periodic = await createDemoWorkspace('PERIODIC_COUNT', fixture.user.id);
  const store = await createDemoWorkspace('ORDER_CYCLE', fixture.user.id);
  demos.push(daily.id, periodic.id, store.id);

  expect(await loadActiveSkusWithSeries(daily.id, undefined, today)).toHaveLength(60);
  const { rows } = await getPeriodicRows(periodic.id, today);
  expect(rows).toHaveLength(35);
  expect(rows.filter((r) => r.estimate.dailyUsage !== null).length).toBeGreaterThan(20);
  const storeData = await getStoreDashboard(store.id, today);
  expect(storeData.rows).toHaveLength(6);
  expect(storeData.rows.filter((r) => r.analysis.estimate.amount !== null).length).toBeGreaterThanOrEqual(5);

  const metrics = computePlatformMetrics(await listWorkspaceSummaries());
  expect(metrics.demoCount).toBeGreaterThanOrEqual(3);
});

it('deletes a workspace with all its data and leaves other workspaces intact', async () => {
  await createSnapshot({ warehouseId: fixture.warehouse.id, uploadedById: fixture.user.id, snapshotDate: new Date('2026-09-10'),
    sourceFileName: 'keep.xlsx', fileHash: 'keep', rows: [row('KEEP', 10)] });
  const demo = await createDemoWorkspace('DAILY_SYNC', fixture.user.id);
  demos.push(demo.id);
  const demoWarehouses = (await prisma.warehouse.findMany({ where: { organizationId: demo.id }, select: { id: true } })).map((w) => w.id);
  expect(await prisma.inventorySnapshot.count({ where: { warehouseId: { in: demoWarehouses } } })).toBeGreaterThan(0);

  await deleteWorkspace(demo.id);
  expect(await prisma.organization.findUnique({ where: { id: demo.id } })).toBeNull();
  expect(await prisma.sku.count({ where: { warehouseId: { in: demoWarehouses } } })).toBe(0);
  expect(await prisma.inventorySnapshot.count({ where: { warehouseId: { in: demoWarehouses } } })).toBe(0);
  expect(await prisma.inventorySnapshot.count({ where: { warehouseId: fixture.warehouse.id } })).toBe(1);
});
