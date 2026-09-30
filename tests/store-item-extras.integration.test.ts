import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase } from './db-fixtures';
import { createStoreItem, listStoreItemExtras, updateStoreItemExtras } from '../src/server/repositories/store-repository';
import { addExpirationLot } from '../src/server/repositories/expiration-repository';
import { listRegisteredCosts } from '../src/server/repositories/cost-repository';
import { getStoreDashboard, getStoreItemDetail } from '../src/server/services/store-service';

requireTestDatabase();

let f: Awaited<ReturnType<typeof createFixture>>;
let item: string;

beforeEach(async () => {
  f = await createFixture();
  item = (await createStoreItem(f.org.id, { name: '우유 1L', unit: '팩', leadTimeDays: 1 }))!.id;
});
afterEach(() => cleanupFixture(f));
afterAll(() => prisma.$disconnect());

const info = { unitCost: 2400, spec: '1L', storage: '냉장', barcode: '8801234567890', packSize: 12, note: '오후 3시 전 주문', expirationRiskDays: 3 };

it('saves cost and reference info on a store item and shows it in the detail and cost list', async () => {
  expect(await updateStoreItemExtras(f.org.id, item, info)).toBe(true);
  const extras = (await listStoreItemExtras(f.org.id))[item];
  expect(extras).toMatchObject({ unitCost: 2400, spec: '1L', storage: '냉장', barcode: '8801234567890', packSize: 12, note: '오후 3시 전 주문', expirationRiskDays: 3 });

  const detail = await getStoreItemDetail(f.org.id, item, '2026-09-30');
  expect(detail?.extras.unitCost).toBe(2400);
  expect((await listRegisteredCosts(f.org.id)).map((c) => [c.skuId, c.unitCost, c.source])).toEqual([[item, 2400, 'MANUAL']]);

  // 빈 칸으로 저장하면 지운다.
  await updateStoreItemExtras(f.org.id, item, { unitCost: null, spec: '', storage: '', barcode: '', packSize: null, note: '', expirationRiskDays: null });
  expect((await listStoreItemExtras(f.org.id))[item]).toMatchObject({ unitCost: null, spec: '', packSize: null, expirationRiskDays: null });
  expect(await listRegisteredCosts(f.org.id)).toEqual([]);
});

it('marks a store item whose earliest expiration is within its warning days', async () => {
  await updateStoreItemExtras(f.org.id, item, info);
  await addExpirationLot(f.org.id, item, null, '2026-10-10');
  await addExpirationLot(f.org.id, item, null, '2026-10-02');
  expect((await listStoreItemExtras(f.org.id))[item].lots.map((l) => [l.lot, l.expirationDate])).toEqual([
    ['A', '2026-10-02'],
    ['B', '2026-10-10'],
  ]);

  const [row] = (await getStoreDashboard(f.org.id, '2026-09-30')).rows;
  expect(row.expiringSoon).toEqual({ date: '2026-10-02', daysLeft: 2 });
  const [later] = (await getStoreDashboard(f.org.id, '2026-09-20')).rows;
  expect(later.expiringSoon).toBeNull(); // 12일 남음 > 기준 3일
});

it('does not touch items of another workspace', async () => {
  const other = await createFixture();
  try {
    expect(await updateStoreItemExtras(other.org.id, item, info)).toBe(false);
    expect(await listStoreItemExtras(other.org.id)).toEqual({});
  } finally {
    await cleanupFixture(other);
  }
});
