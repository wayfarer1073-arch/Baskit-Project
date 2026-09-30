import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase, row } from './db-fixtures';
import { createSnapshot, resetUploadForDate } from '../src/server/repositories/snapshot-repository';
import { loadActiveSkusWithSeries } from '../src/server/repositories/inventory-repository';

requireTestDatabase();

let f: Awaited<ReturnType<typeof createFixture>>;

beforeEach(async () => {
  f = await createFixture();
});
afterEach(() => cleanupFixture(f));
afterAll(() => prisma.$disconnect());

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

const upload = (date: string, rows: ReturnType<typeof row>[], replaceExisting = true) =>
  createSnapshot({ warehouseId: f.warehouse.id, snapshotDate: day(date), sourceFileName: `${date}.xlsx`, fileHash: date, uploadedById: f.user.id, rows, replaceExisting });

async function versions(productCode = 'A') {
  const sku = await prisma.sku.findFirstOrThrow({ where: { warehouseId: f.warehouse.id, productCode } });
  const rows = await prisma.skuAttributeVersion.findMany({ where: { skuId: sku.id }, orderBy: { effectiveDate: 'asc' } });
  return rows.map((v) => [v.effectiveDate.toISOString().slice(0, 10), v.productName, v.location]);
}

async function nameOn(asOfDate: string, productCode = 'A') {
  const list = await loadActiveSkusWithSeries(f.org.id, f.warehouse.id, asOfDate);
  return list.find((s) => s.descriptor.productCode === productCode)?.descriptor;
}

it('keeps product attributes only on the days they change and shows the value of each date', async () => {
  await upload('2026-09-01', [row('A', 100, { productName: '사과', location: 'A-1' })]);
  await upload('2026-09-02', [row('A', 90, { productName: '사과', location: 'A-1' })]);
  await upload('2026-09-03', [row('A', 80, { productName: '사과 5kg', location: 'B-2', warningQty: 20 })]);

  expect(await versions()).toEqual([
    ['2026-09-01', '사과', 'A-1'],
    ['2026-09-03', '사과 5kg', 'B-2'],
  ]);
  expect(await nameOn('2026-09-02')).toMatchObject({ productName: '사과', location: 'A-1' });
  expect(await nameOn('2026-09-03')).toMatchObject({ productName: '사과 5kg', location: 'B-2' });

  // 재고 행에는 숫자만 남는다.
  const items = await prisma.inventoryItem.findMany({ where: { snapshot: { warehouseId: f.warehouse.id } } });
  expect(items).toHaveLength(3);
  expect(Object.keys(items[0]).sort()).toEqual(['defectiveStock', 'extra', 'incomingStock', 'normalStock', 'skuId', 'snapshotId', 'totalCost', 'unitCost', 'unitCostProvided']);
});

it('merges a later version that becomes redundant when an earlier date is uploaded afterwards', async () => {
  await upload('2026-09-05', [row('A', 50, { productName: '배' })]);
  await upload('2026-09-01', [row('A', 70, { productName: '배' })]);
  expect(await versions()).toEqual([['2026-09-01', '배', null]]);
});

it('deletes the rows of a replaced upload right away and keeps who uploaded it', async () => {
  await upload('2026-09-01', [row('A', 100), row('B', 5)]);
  const first = await prisma.inventorySnapshot.findFirstOrThrow({ where: { warehouseId: f.warehouse.id } });
  await upload('2026-09-01', [row('A', 90)]);

  const replaced = await prisma.inventorySnapshot.findUniqueOrThrow({ where: { id: first.id } });
  expect(replaced.status).toBe('REPLACED');
  expect(await prisma.inventoryItem.count({ where: { snapshotId: first.id } })).toBe(0);
  // 다시 올린 목록에서 빠진 B는 그날 관측이 없어졌으므로 그날 속성 버전도 정리된다.
  expect(await versions('B')).toEqual([]);
});

it('moves a version to the next observed day when its upload is reset', async () => {
  await upload('2026-09-01', [row('A', 100, { productName: '감' })]);
  await upload('2026-09-02', [row('A', 90, { productName: '감 1kg' })]);
  await upload('2026-09-03', [row('A', 80, { productName: '감 1kg' })]);
  await resetUploadForDate(f.warehouse.id, day('2026-09-02'));

  expect(await versions()).toEqual([
    ['2026-09-01', '감', null],
    ['2026-09-03', '감 1kg', null],
  ]);
  expect(await nameOn('2026-09-03')).toMatchObject({ productName: '감 1kg' });
  const sku = await prisma.sku.findFirstOrThrow({ where: { warehouseId: f.warehouse.id, productCode: 'A' } });
  expect(sku.currentProductName).toBe('감 1kg');

  // 최신 날짜를 지우면 SKU의 지금 값도 남은 최신 날짜 값으로 돌아간다.
  await resetUploadForDate(f.warehouse.id, day('2026-09-03'));
  expect((await prisma.sku.findUniqueOrThrow({ where: { id: sku.id } })).currentProductName).toBe('감');
  expect(await versions()).toEqual([['2026-09-01', '감', null]]);
});
