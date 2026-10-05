import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase } from './db-fixtures';
import { addPurchaseOrders, createStoreItem, getEasyCountSheet, saveEasyCount } from '../src/server/repositories/store-repository';

requireTestDatabase();

let f: Awaited<ReturnType<typeof createFixture>>;
let milk: string;
let beans: string;

beforeEach(async () => {
  f = await createFixture();
  milk = (await createStoreItem(f.org.id, { name: '우유 1L', unit: '팩', leadTimeDays: 1 }))!.id;
  beans = (await createStoreItem(f.org.id, { name: '원두 1kg', unit: '봉', leadTimeDays: 2 }))!.id;
});
afterEach(() => cleanupFixture(f));
afterAll(() => prisma.$disconnect());

it('shows the latest order until the first count, then the previous count', async () => {
  await addPurchaseOrders(f.org.id, { date: '2026-09-28', lines: [{ itemId: milk, quantity: 24, coverageAmount: null, leftoverQuantity: null }], createdById: f.user.id });
  let sheet = await getEasyCountSheet(f.org.id, '2026-10-01');
  const milkRow = sheet.find((i) => i.id === milk)!;
  expect(milkRow).toMatchObject({ name: '우유 1L', unit: '팩', current: null, previous: null, lastOrder: { date: '2026-09-28', quantity: 24 } });
  expect(sheet.find((i) => i.id === beans)).toMatchObject({ previous: null, lastOrder: null });

  // EA와 개봉품 잔량을 나눠 적는다. 잔량만 적으면 EA는 0.
  expect(
    await saveEasyCount(f.org.id, {
      date: '2026-10-01',
      lines: [
        { itemId: milk, fullUnits: 7, openedPercent: 40 },
        { itemId: beans, fullUnits: null, openedPercent: 60 },
      ],
      createdById: f.user.id,
    }),
  ).toEqual({ saved: 2, cleared: 0 });
  sheet = await getEasyCountSheet(f.org.id, '2026-10-01');
  expect(sheet.find((i) => i.id === milk)).toMatchObject({ current: { fullUnits: 7, openedPercent: 40 }, previous: null });
  expect(sheet.find((i) => i.id === beans)).toMatchObject({ current: { fullUnits: 0, openedPercent: 60 } });

  // 다음 날에는 그 기록이 '지난 기록'이 된다.
  sheet = await getEasyCountSheet(f.org.id, '2026-10-02');
  expect(sheet.find((i) => i.id === milk)).toMatchObject({ current: null, previous: { date: '2026-10-01', fullUnits: 7, openedPercent: 40 } });
  // 그 전날에는 보이지 않는다.
  expect((await getEasyCountSheet(f.org.id, '2026-09-30')).find((i) => i.id === milk)?.previous).toBeNull();
});

it('overwrites the same day and clears a line saved empty', async () => {
  await saveEasyCount(f.org.id, { date: '2026-10-01', lines: [{ itemId: milk, fullUnits: 7, openedPercent: 40 }], createdById: f.user.id });
  await saveEasyCount(f.org.id, { date: '2026-10-01', lines: [{ itemId: milk, fullUnits: 5, openedPercent: null }], createdById: f.user.id });
  expect(await prisma.storeStockCount.count({ where: { skuId: milk } })).toBe(1);
  expect((await getEasyCountSheet(f.org.id, '2026-10-01')).find((i) => i.id === milk)?.current).toEqual({ fullUnits: 5, openedPercent: null });
  expect(await saveEasyCount(f.org.id, { date: '2026-10-01', lines: [{ itemId: milk, fullUnits: null, openedPercent: null }], createdById: f.user.id })).toEqual({
    saved: 0,
    cleared: 1,
  });
  expect(await prisma.storeStockCount.count({ where: { skuId: milk } })).toBe(0);
});

it('refuses items of another workspace without saving anything', async () => {
  const other = await createFixture();
  try {
    const foreign = (await createStoreItem(other.org.id, { name: '컵', unit: '박스', leadTimeDays: 1 }))!.id;
    expect(
      await saveEasyCount(f.org.id, {
        date: '2026-10-01',
        lines: [
          { itemId: milk, fullUnits: 1, openedPercent: null },
          { itemId: foreign, fullUnits: 1, openedPercent: null },
        ],
        createdById: f.user.id,
      }),
    ).toBeNull();
    expect(await prisma.storeStockCount.count({ where: { skuId: { in: [milk, foreign] } } })).toBe(0);
  } finally {
    await cleanupFixture(other);
  }
});
