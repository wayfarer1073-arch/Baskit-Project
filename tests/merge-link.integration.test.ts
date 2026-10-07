import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase } from './db-fixtures';
import { listMergeLinks, MergeLinkError, setSkuMerge } from '../src/server/repositories/merge-repository';

requireTestDatabase();
let a: Awaited<ReturnType<typeof createFixture>>;
let b: Awaited<ReturnType<typeof createFixture>>;
let second: { id: string };
beforeEach(async () => {
  a = await createFixture();
  b = await createFixture();
  second = await prisma.warehouse.create({ data: { organizationId: a.org.id, code: `B-${a.org.id}`, name: '두 번째 창고' } });
});
afterEach(async () => {
  await prisma.sku.deleteMany({ where: { warehouseId: second.id } });
  await prisma.warehouse.delete({ where: { id: second.id } });
  await cleanupFixture(a);
  await cleanupFixture(b);
});
afterAll(() => prisma.$disconnect());

const sku = (warehouseId: string, productCode: string) =>
  prisma.sku.create({ data: { warehouseId, productCode, currentProductName: productCode, firstSeenDate: new Date('2026-09-01'), lastSeenDate: new Date('2026-09-01') } });

it('links an item to the same item in another warehouse, and refuses same-warehouse or foreign links', async () => {
  const main = await sku(a.warehouse.id, 'P-100');
  const other = await sku(second.id, 'X-9');
  const sameWarehouse = await sku(a.warehouse.id, 'P-200');
  expect(await setSkuMerge(a.org.id, other.id, main.id)).toBe(true);
  // 묶음의 기준 품목(P-100)도 함께 나와 어느 창고의 무엇과 묶였는지 보인다.
  expect((await listMergeLinks(a.org.id)).map((l) => [l.productCode, l.mergeKey, l.anchor])).toEqual([
    ['P-100', 'P-100', true],
    ['X-9', 'P-100', false],
  ]);
  await expect(setSkuMerge(a.org.id, sameWarehouse.id, main.id)).rejects.toBeInstanceOf(MergeLinkError);
  expect(await setSkuMerge(b.org.id, other.id, null)).toBe(false);
  expect(await setSkuMerge(a.org.id, other.id, null)).toBe(true);
  expect(await listMergeLinks(a.org.id)).toEqual([]);
});
