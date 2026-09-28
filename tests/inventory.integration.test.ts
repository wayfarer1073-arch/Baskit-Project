import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { createSnapshot } from '../src/server/repositories/snapshot-repository';
import { loadActiveSkusWithSeries, loadDailyWarehouseTotals, loadSkuWithSeries } from '../src/server/repositories/inventory-repository';
import { addInboundEntry } from '../src/server/repositories/inbound-repository';
import { calculatePeriodComparison } from '../src/domain/inventory/calculations';
import { resolveInventoryCost } from '../src/domain/inventory/costs';
import { cleanupFixture, createFixture, requireTestDatabase, row } from './db-fixtures';

requireTestDatabase();
let fixture: Awaited<ReturnType<typeof createFixture>>;
beforeEach(async () => { fixture = await createFixture(); });
afterEach(async () => { if (fixture) await cleanupFixture(fixture); });
afterAll(async () => { await prisma.$disconnect(); });

async function snapshot(date: string, rows = [row('A')]) {
  return createSnapshot({ warehouseId: fixture.warehouse.id, uploadedById: fixture.user.id,
    snapshotDate: new Date(date), sourceFileName: 'fixture.xlsx', fileHash: date, rows });
}
async function skuId(code = 'A') {
  return (await prisma.sku.findUniqueOrThrow({ where: { warehouseId_productCode: {
    warehouseId: fixture.warehouse.id, productCode: code,
  } } })).id;
}

describe('inventory database invariants', () => {
  it('keeps historical SKUs and totals after a later snapshot removes them', async () => {
    await snapshot('2026-09-10', [row('A'), row('B', 50)]);
    await snapshot('2026-09-17', [row('B', 40)]);
    const rows = await loadActiveSkusWithSeries(fixture.org.id, fixture.warehouse.id, '2026-09-10');
    expect(rows.map(r => r.descriptor.productCode).sort()).toEqual(['A', 'B']);
    expect(await loadSkuWithSeries(fixture.org.id, await skuId(), '2026-09-10')).not.toBeNull();
    const totals = (await loadDailyWarehouseTotals(fixture.org.id)).filter(r => r.warehouseId === fixture.warehouse.id);
    expect(totals.find(r => r.date === '2026-09-10')?.totalAvailableStock).toBe(150);
    const current = await loadActiveSkusWithSeries(fixture.org.id, fixture.warehouse.id, '2026-09-17');
    expect(current.filter(r => !r.descriptor.isSoldOut).map(r => r.descriptor.productCode)).toEqual(['B']);
    expect(current.find(r => r.descriptor.productCode === 'A')?.descriptor.isSoldOut).toBe(true);
  });

  it('counts inbound between observations once, including after backfill and replacement', async () => {
    await snapshot('2026-09-10');
    const id = await skuId();
    await addInboundEntry({ warehouseId: fixture.warehouse.id, skuId: id, date: '2026-09-11', quantity: 50 });
    await snapshot('2026-09-12', [row('A', 120)]);
    const check = async () => {
      const detail = await loadSkuWithSeries(fixture.org.id, id, '2026-09-12');
      const comparison = calculatePeriodComparison(detail!.observations, '2026-09-10', '2026-09-12');
      expect(comparison?.totalDepletion).toBe(30);
      expect(comparison?.totalInboundQuantity).toBe(50);
      const list = await loadActiveSkusWithSeries(fixture.org.id, fixture.warehouse.id, '2026-09-12');
      expect(list[0].observations).toEqual(detail!.observations);
    };
    await check();
    await snapshot('2026-09-11', [row('A', 140)]);
    await check();
    await snapshot('2026-09-11', [row('A', 135)]);
    await check();
  });

  it('preserves every concurrently added inbound quantity', async () => {
    await snapshot('2026-09-10');
    const input = { warehouseId: fixture.warehouse.id, skuId: await skuId(), date: '2026-09-11' };
    await addInboundEntry({ ...input, quantity: 100 });
    const results = await Promise.all(Array.from({ length: 12 }, () => addInboundEntry({ ...input, quantity: 10 })));
    expect(results.every(r => r.ok)).toBe(true);
    const entry = await prisma.snapshotInbound.findUniqueOrThrow({ where: { skuId_snapshotDate: { skuId: input.skuId, snapshotDate: new Date(input.date) } } });
    expect(entry.quantity).toBe(220);
  });

  it('preserves source cost history when an earlier snapshot is replaced', async () => {
    await snapshot('2026-09-10', [row('A', 100, { unitCost: 12 })]);
    await snapshot('2026-09-12', [row('A', 80, { unitCost: 0, costMissing: true })]);
    await snapshot('2026-09-10', [row('A', 100, { unitCost: 15 })]);
    const detail = await loadSkuWithSeries(fixture.org.id, await skuId(), '2026-09-12');
    expect(detail!.observations.at(-1)?.unitCost).toBe(15);
    expect(detail!.observations.at(-1)?.totalCost).toBe(1200);
    expect(await prisma.inventorySnapshot.count({ where: { warehouseId: fixture.warehouse.id, status: 'ACTIVE', snapshotDate: new Date('2026-09-10') } })).toBe(1);
  });

  it('matches domain cost resolution in SQL totals, without using future costs', async () => {
    const knownCosts = new Map<string, number | null>();
    const expected = new Map<string, number>();
    for (let day = 1; day <= 12; day++) {
      const date = `2026-08-${String(day).padStart(2, '0')}`;
      const rows = [
        row('no-cost', 10, { costMissing: true, unitCost: 0 }),
        row('inferred', day === 2 ? 0 : 10, { costMissing: true, unitCost: 0, totalCost: day >= 2 && day <= 4 ? day * 31 : null }),
        row('explicit', 10, { costMissing: day !== 3 && day !== 8, unitCost: day === 8 ? 0 : 25, totalCost: day === 6 ? 123 : null }),
        row('mixed', 7, { costMissing: day !== 7, unitCost: 9, totalCost: day === 4 ? 100 : null }),
      ];
      await snapshot(date, rows);
      let total = 0;
      for (const r of rows) {
        const resolved = resolveInventoryCost({ ...r, unitCostProvided: !r.costMissing }, knownCosts.get(r.productCode) ?? null);
        knownCosts.set(r.productCode, resolved.latestKnownUnitCost);
        total += resolved.totalCost;
      }
      expected.set(date, total);
    }
    for (const cutoff of ['2026-08-02', '2026-08-05', '2026-08-12']) {
      const totals = (await loadDailyWarehouseTotals(fixture.org.id, cutoff)).filter(r => r.warehouseId === fixture.warehouse.id);
      expect(totals).toHaveLength(Number(cutoff.slice(-2)));
      for (const total of totals) expect(total.totalInventoryValue).toBeCloseTo(expected.get(total.date)!, 6);
    }
  });

  it('serializes concurrent first inbound inserts and rejects overflow without changing the total', async () => {
    await snapshot('2026-09-10');
    const input = { warehouseId: fixture.warehouse.id, skuId: await skuId(), date: '2026-09-11' };
    const results = await Promise.all(Array.from({ length: 8 }, () => addInboundEntry({ ...input, quantity: 10 })));
    expect(results.every(r => r.ok)).toBe(true);
    const where = { skuId_snapshotDate: { skuId: input.skuId, snapshotDate: new Date(input.date) } };
    expect((await prisma.snapshotInbound.findUniqueOrThrow({ where })).quantity).toBe(80);
    expect((await addInboundEntry({ ...input, quantity: 2_147_483_647 })).ok).toBe(false);
    expect((await prisma.snapshotInbound.findUniqueOrThrow({ where })).quantity).toBe(80);
  });

  it('keeps the latest SKU state when two different dates upload concurrently', async () => {
    await snapshot('2026-09-10', [row('A'), row('B')]);
    await Promise.all([
      snapshot('2026-09-11', [row('A', 80, { productName: 'old name' }), row('B')]),
      snapshot('2026-09-12', [row('A', 70, { productName: 'new name' })]),
    ]);
    const a = await prisma.sku.findUniqueOrThrow({ where: { id: await skuId() } });
    const b = await prisma.sku.findUniqueOrThrow({ where: { id: await skuId('B') } });
    expect(a.currentProductName).toBe('new name');
    expect(a.lastSeenDate.toISOString().slice(0, 10)).toBe('2026-09-12');
    expect(b.isActive).toBe(false);
  });

  it('does not silently replace a snapshot when two non-replacement uploads race', async () => {
    const input = { warehouseId: fixture.warehouse.id, uploadedById: fixture.user.id,
      snapshotDate: new Date('2026-09-10'), sourceFileName: 'fixture.xlsx', fileHash: 'race', rows: [row('A')], replaceExisting: false };
    const results = await Promise.allSettled([createSnapshot(input), createSnapshot(input)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(await prisma.inventorySnapshot.count({ where: { warehouseId: fixture.warehouse.id } })).toBe(1);
  });

  it('keeps a SKU discovered only in a backfill inactive today but visible historically', async () => {
    await snapshot('2026-09-12', [row('B')]);
    await snapshot('2026-09-10', [row('A'), row('B')]);
    expect((await prisma.sku.findUniqueOrThrow({ where: { id: await skuId() } })).isActive).toBe(false);
    expect((await loadActiveSkusWithSeries(fixture.org.id, fixture.warehouse.id, '2026-09-10')).map(r => r.descriptor.productCode).sort()).toEqual(['A', 'B']);
    expect(await loadSkuWithSeries(fixture.org.id, await skuId(), '2026-09-12')).toBeNull();
  });

  it('uses mock history only before the first real snapshot and applies visibility consistently', async () => {
    await createSnapshot({ warehouseId: fixture.warehouse.id, uploadedById: fixture.user.id,
      snapshotDate: new Date('2026-09-10'), sourceFileName: 'mock.xlsx', fileHash: 'mock', rows: [row('A', 200)], isMock: true });
    await snapshot('2026-09-12', [row('A', 100)]);
    const before = await loadActiveSkusWithSeries(fixture.org.id, fixture.warehouse.id, '2026-09-10');
    expect(before[0].observations[0].normalStock).toBe(200);
    const after = await loadActiveSkusWithSeries(fixture.org.id, fixture.warehouse.id, '2026-09-12');
    expect(after[0].observations).toHaveLength(1);
    expect(after[0].observations[0].normalStock).toBe(100);
    expect((await loadDailyWarehouseTotals(fixture.org.id, '2026-09-10')).filter(r => r.warehouseId === fixture.warehouse.id)[0].totalAvailableStock).toBe(200);
    expect((await loadDailyWarehouseTotals(fixture.org.id, '2026-09-12')).filter(r => r.warehouseId === fixture.warehouse.id)).toHaveLength(1);
    await prisma.sku.update({ where: { id: await skuId() }, data: { isHiddenFromDashboard: true } });
    expect(await loadActiveSkusWithSeries(fixture.org.id, fixture.warehouse.id, '2026-09-10')).toEqual([]);
    expect((await loadDailyWarehouseTotals(fixture.org.id)).filter(r => r.warehouseId === fixture.warehouse.id)).toEqual([]);
  });

  it('writes more than one batch and rolls back an invalid replacement completely', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => row(`batch-${i}`));
    const original = await snapshot('2026-09-10', rows);
    expect(await prisma.inventoryItem.count({ where: { snapshotId: original.id } })).toBe(1001);
    await expect(snapshot('2026-09-10', [row('batch-0', 2_147_483_648)])).rejects.toThrow();
    expect(await prisma.inventorySnapshot.count({ where: { warehouseId: fixture.warehouse.id } })).toBe(1);
    expect((await prisma.inventorySnapshot.findUniqueOrThrow({ where: { id: original.id } })).status).toBe('ACTIVE');
    expect(await prisma.sku.count({ where: { warehouseId: fixture.warehouse.id, isActive: true } })).toBe(1001);
  });

  it('allocates sequential versions for simultaneous replacements', async () => {
    await snapshot('2026-09-10');
    await Promise.all([snapshot('2026-09-10', [row('A', 90)]), snapshot('2026-09-10', [row('A', 80)])]);
    const versions = await prisma.inventorySnapshot.findMany({ where: { warehouseId: fixture.warehouse.id }, orderBy: { version: 'asc' } });
    expect(versions.map(s => s.version)).toEqual([1, 2, 3]);
    expect(versions.map(s => s.status)).toEqual(['REPLACED', 'REPLACED', 'ACTIVE']);
  });
});

it('preserves valuation completeness through database, service, and KPI aggregation', async () => {
  await snapshot('2026-09-10', [row('unknown', 10, {costMissing: true, unitCost: 0}), row('free', 10, {unitCost: 0}), row('total', 10, {costMissing: true, totalCost: 95}), row('negative', -10)]);
  const { getInventoryRows } = await import('../src/server/services/inventory-analysis-service');
  const { calculateCompanyKpis } = await import('../src/domain/inventory/aggregation');
  const { DEFAULT_RISK_SETTINGS } = await import('../src/domain/inventory/types');
  const rows = await getInventoryRows({ orgId: fixture.org.id, warehouseId: fixture.warehouse.id, asOfDate: '2026-09-10', settings: DEFAULT_RISK_SETTINGS});
  const kpis = calculateCompanyKpis(rows, 30);
  expect(kpis.snapshot).toMatchObject({knownInventoryValue: 95, valuedSkuCount: 2, unvaluedSkuCount: 2, negativeStockSkuCount: 1, positiveStockSkuCount: 3});
  expect(rows.find(r=>r.descriptor.productCode === 'unknown')!.analysis.latest.valuationKnown).toBe(false);
  await snapshot('2026-09-11', [row('unknown', 8, {unitCost: 5})]);
  const historical = await getInventoryRows({ orgId: fixture.org.id, warehouseId: fixture.warehouse.id, asOfDate: '2026-09-10', settings: DEFAULT_RISK_SETTINGS});
  expect(calculateCompanyKpis(historical, 30).snapshot.knownInventoryValue).toBe(95);
});

it('does not mix newly introduced SKUs into requested-period KPI changes', async () => {
  await snapshot('2026-09-10', [row('A', 100)]);
  await snapshot('2026-09-11', [row('A', 90), row('B', 50)]);
  await snapshot('2026-09-12', [row('A', 80), row('B', 20)]);
  const { getInventoryRows } = await import('../src/server/services/inventory-analysis-service');
  const { calculateCompanyKpis } = await import('../src/domain/inventory/aggregation');
  const { DEFAULT_RISK_SETTINGS } = await import('../src/domain/inventory/types');
  const rows = await getInventoryRows({ orgId: fixture.org.id, warehouseId: fixture.warehouse.id, asOfDate: '2026-09-12', compareFromDate: '2026-09-10', settings: DEFAULT_RISK_SETTINGS});
  expect(calculateCompanyKpis(rows, 30, '2026-09-10').snapshot).toMatchObject({comparableSkuCount: 1, observedDecrease: 20, estimatedDepletion: 20});
});
