import { performance } from 'node:perf_hooks';
import { prisma } from '../src/lib/prisma';
import { createSnapshot } from '../src/server/repositories/snapshot-repository';
import { loadActiveSkusWithSeries, loadDailyWarehouseTotals } from '../src/server/repositories/inventory-repository';
import { cleanupFixture, createFixture, requireTestDatabase, row } from '../tests/db-fixtures';

async function main() {
  requireTestDatabase();
  const skuCount = Number(process.env.BENCH_SKUS ?? 500);
  const days = Number(process.env.BENCH_DAYS ?? 60);
  const repeats = Number(process.env.BENCH_REPEATS ?? 5);
  if (![skuCount, days, repeats].every(n => Number.isInteger(n) && n > 0)) throw new Error('Positive integer benchmark sizes required');
  const fixture = await createFixture();
  const samples: Record<string, number[]> = {};
  async function measure(name: string, work: () => Promise<unknown>) {
    const start = performance.now();
    await work();
    (samples[name] ??= []).push(performance.now() - start);
  }
  try {
    const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i));
    // Bulk seed history so benchmark setup does not dominate the measured upload.
    await prisma.sku.createMany({ data: Array.from({ length: skuCount }, (_, i) => ({
      warehouseId: fixture.warehouse.id, productCode: `SKU-${i}`, currentProductName: `SKU-${i}`,
      firstSeenDate: day(0), lastSeenDate: day(days - 1),
    })) });
    const skus = await prisma.sku.findMany({ where: { warehouseId: fixture.warehouse.id } });
    for (let d = 0; d < days; d++) {
      const snap = await prisma.inventorySnapshot.create({ data: {
        warehouseId: fixture.warehouse.id, snapshotDate: day(d), sourceFileName: 'benchmark',
        fileHash: `${d}`, rowCount: skuCount, uploadedById: fixture.user.id,
      } });
      await prisma.inventoryItem.createMany({ data: skus.map(s => ({
        snapshotId: snap.id, skuId: s.id, normalStock: 1000 - d, unitCost: 10,
      })) });
    }
    for (let i = 0; i < repeats; i++) {
      await measure('upload_ms', () => createSnapshot({ warehouseId: fixture.warehouse.id,
        snapshotDate: day(days), sourceFileName: 'benchmark', fileHash: 'benchmark', uploadedById: fixture.user.id,
        rows: skus.map(s => row(s.productCode, 900)),
      }));
    }
    const asOfDate = day(days).toISOString().slice(0, 10);
    await loadActiveSkusWithSeries(fixture.org.id, fixture.warehouse.id, asOfDate);
    await loadDailyWarehouseTotals(fixture.org.id);
    for (let i = 0; i < repeats; i++) {
      await measure('series_ms', () => loadActiveSkusWithSeries(fixture.org.id, fixture.warehouse.id, asOfDate));
      await measure('daily_totals_ms', () => loadDailyWarehouseTotals(fixture.org.id));
    }
    console.log(JSON.stringify({ skuCount, days, repeats, inventoryItems: skuCount * (days + repeats),
      measurements: Object.fromEntries(Object.entries(samples).map(([key, values]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return [key, { samples: values.map(n => +n.toFixed(1)), median: +sorted[Math.floor(sorted.length / 2)].toFixed(1), max: +sorted.at(-1)!.toFixed(1) }];
      })), processMemoryMB: +(process.memoryUsage().rss / 1024 / 1024).toFixed(1),
    }, null, 2));
  } finally { await cleanupFixture(fixture); }
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
