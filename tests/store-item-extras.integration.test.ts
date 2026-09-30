import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase } from './db-fixtures';
import { addPurchaseOrders, createStoreItem, listRecentOrders, listStoreItemExtras, setOrderExpiration, updateStoreItemExtras } from '../src/server/repositories/store-repository';
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

it('follows the expiration entered with an order on the dashboard', async () => {
  await updateStoreItemExtras(f.org.id, item, info); // 임박 기준 3일
  await addPurchaseOrders(f.org.id, { date: '2026-09-20', lines: [{ itemId: item, quantity: 12, coverageAmount: 100000, leftoverQuantity: null, expirationDate: '2026-10-01' }], createdById: f.user.id });
  // 다음 발주: 잔량이 남아 있었으니 이전 발주분(10-01)도 아직 있다.
  await addPurchaseOrders(f.org.id, { date: '2026-09-27', lines: [{ itemId: item, quantity: 12, coverageAmount: 100000, leftoverQuantity: 2, expirationDate: '2026-10-09' }], createdById: f.user.id });

  const [row] = (await getStoreDashboard(f.org.id, '2026-09-30')).rows;
  expect(row.expiration).toMatchObject({ date: '2026-10-01', daysLeft: 1, near: true, orderDate: '2026-09-20' });
  const [earlier] = (await getStoreDashboard(f.org.id, '2026-09-21')).rows;
  expect(earlier.expiration).toMatchObject({ date: '2026-10-01', daysLeft: 10, near: false });

  // 나중에 소비기한을 고치거나 지울 수 있다.
  const [latest] = await listRecentOrders(f.org.id, 1, item);
  expect(latest.expirationDate).toBe('2026-10-09');
  expect(await setOrderExpiration(f.org.id, latest.id, '2026-09-01')).toBe('before_order');
  expect(await setOrderExpiration(f.org.id, latest.id, null)).toBe('ok');
  expect((await listRecentOrders(f.org.id, 1, item))[0].expirationDate).toBeNull();
});

it('does not follow items whose orders have no expiration', async () => {
  await addPurchaseOrders(f.org.id, { date: '2026-09-27', lines: [{ itemId: item, quantity: 12, coverageAmount: 100000, leftoverQuantity: null }], createdById: f.user.id });
  expect((await getStoreDashboard(f.org.id, '2026-09-30')).rows[0].expiration).toBeNull();
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
