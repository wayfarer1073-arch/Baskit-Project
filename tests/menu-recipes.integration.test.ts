import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase } from './db-fixtures';
import { addPurchaseOrders, createStoreItem, saveEasyCount } from '../src/server/repositories/store-repository';
import { createMenu, importMenuSales, matchMenuNames, saveMenuSalesTemplate, findMenuSalesTemplate, setItemContent, setRecipe } from '../src/server/repositories/menu-repository';
import { getLossReport, getRecipeOverview, previewMenuSales } from '../src/server/services/menu-service';

requireTestDatabase();

let f: Awaited<ReturnType<typeof createFixture>>;
let beans: string;
let cups: string;

beforeEach(async () => {
  f = await createFixture();
  beans = (await createStoreItem(f.org.id, { name: '원두', unit: '봉', leadTimeDays: 1 }))!.id;
  cups = (await createStoreItem(f.org.id, { name: '컵', unit: '개', leadTimeDays: 1 }))!.id;
});
afterEach(async () => {
  await prisma.menuSale.deleteMany({ where: { organizationId: f.org.id } });
  await prisma.storeMenuAlias.deleteMany({ where: { organizationId: f.org.id } });
  await prisma.storeMenu.deleteMany({ where: { organizationId: f.org.id } });
  await prisma.importTemplate.deleteMany({ where: { organizationId: f.org.id } });
  await cleanupFixture(f);
});
afterAll(() => prisma.$disconnect());

const posFile = [
  ['상품별 매출 현황'],
  ['조회기간 : 2026-10-02 ~ 2026-10-02'],
  ['상품코드', '상품명', '판매수량', '실매출액'],
  ['A01', '아메리카노(ICE)', '30', '135000'],
  ['A02', '쿠키', '4', '12000'],
  ['', '합계', '34', '147000'],
];

it('imports POS menu sales, remembers name links, and computes recipe usage and estimated stock', async () => {
  const americano = await createMenu(f.org.id, { name: '아메리카노' });
  await setItemContent(f.org.id, beans, { contentPerUnit: 1000, contentUnit: 'g' });
  expect(
    await setRecipe(f.org.id, americano.id, [
      { itemId: beans, quantity: 20 },
      { itemId: cups, quantity: 1 },
    ]),
  ).toBe('ok');

  const preview = await previewMenuSales(f.org.id, posFile, {});
  expect(preview.source).toBe('auto');
  expect(preview.periodDate).toBe('2026-10-02');
  expect(preview.needsDate).toBe(false);
  expect(preview.names.map((n) => [n.name, n.match.kind])).toEqual([
    ['아메리카노(ICE)', 'none'],
    ['쿠키', 'none'],
  ]);

  const lines = preview.rows.map((r) => ({ date: r.date!, name: r.name, quantity: r.quantity, amount: r.amount }));
  const result = await importMenuSales(f.org.id, {
    lines,
    decisions: [
      { name: '아메리카노(ICE)', code: 'A01', action: 'menu', menuId: americano.id },
      { name: '쿠키', code: 'A02', action: 'new' },
    ],
  });
  expect(result).toMatchObject({ saved: 2, menusCreated: 1, from: '2026-10-02', to: '2026-10-02' });
  // 다시 올려도 같은 날은 덮어쓴다.
  await importMenuSales(f.org.id, {
    lines,
    decisions: [
      { name: '아메리카노(ICE)', code: 'A01', action: 'menu', menuId: americano.id },
      { name: '쿠키', code: 'A02', action: 'new' },
    ],
  });
  expect(await prisma.menuSale.count({ where: { organizationId: f.org.id } })).toBe(2);

  // 다음 업로드부터는 이름 연결을 기억한다.
  const matches = await matchMenuNames(f.org.id, [
    { name: '아메리카노(ICE)', code: null },
    { name: '쿠키', code: null },
  ]);
  expect(matches.get('아메리카노(ICE)')).toEqual({ kind: 'menu', menuId: americano.id, via: 'alias' });
  expect(matches.get('쿠키')?.kind).toBe('menu');

  // 소모량: 아메리카노 30잔 × (원두 20 g, 컵 1개) — 쿠키는 레시피가 없어 따로 알려 준다.
  await saveEasyCount(f.org.id, {
    date: '2026-10-01',
    lines: [
      { itemId: beans, fullUnits: 3, openedPercent: 50 },
      { itemId: cups, fullUnits: 100, openedPercent: null },
    ],
    createdById: f.user.id,
  });
  await addPurchaseOrders(f.org.id, { date: '2026-10-02', lines: [{ itemId: cups, quantity: 50, coverageAmount: null, leftoverQuantity: null }], createdById: f.user.id });
  const overview = await getRecipeOverview(f.org.id, '2026-09-26', '2026-10-02');
  const beanRow = overview.rows.find((r) => r.item.id === beans)!;
  expect(beanRow.content).toBe(600);
  expect(beanRow.units).toBeCloseTo(0.6);
  expect(beanRow.estimate).toMatchObject({ baseDate: '2026-10-01', baseUnits: 3.5, orderedSince: 0 });
  expect(beanRow.estimate!.estimatedUnits).toBeCloseTo(2.9);
  const cupRow = overview.rows.find((r) => r.item.id === cups)!;
  expect(cupRow.units).toBe(30);
  expect(cupRow.estimate!.estimatedUnits).toBe(120); // 100 + 50 발주 − 30
  expect(overview.menusWithoutRecipe.map((m) => [m.name, m.quantity])).toEqual([['쿠키', 4]]);
  expect(overview.salesDays).toBe(1);
});

it('saves a custom layout and applies it to files with the same header', async () => {
  const custom = [
    ['판매일', '메뉴 이름', '팔린 개수'],
    ['2026-10-01', '라떼', '3'],
  ];
  expect((await previewMenuSales(f.org.id, custom, {})).source).toBe('none');
  const layout = { headerRowIndex: 0, columns: { date: '판매일', menuName: '메뉴 이름', quantity: '팔린 개수' } };
  const manual = await previewMenuSales(f.org.id, custom, { layout });
  expect(manual.rows).toEqual([{ date: '2026-10-01', code: null, name: '라떼', quantity: 3, amount: null }]);
  await saveMenuSalesTemplate(f.org.id, '우리 POS', custom[0], layout);
  // 열 순서가 바뀌어도 같은 머리글이면 같은 양식(열은 이름으로 찾는다). 머리글이 다르면 다른 양식.
  expect((await findMenuSalesTemplate(f.org.id, [['팔린 개수', '판매일', '메뉴 이름']]))?.name).toBe('우리 POS');
  expect(await findMenuSalesTemplate(f.org.id, [['판매일', '메뉴', '수량']])).toBeNull();
  const again = await previewMenuSales(f.org.id, custom, {});
  expect(again.source).toBe('template');
  expect(again.templateName).toBe('우리 POS');
});

it('remembers ignored names and refuses foreign menus', async () => {
  await importMenuSales(f.org.id, { lines: [{ date: '2026-10-01', name: '봉투', quantity: 3, amount: 300 }], decisions: [{ name: '봉투', code: null, action: 'ignore' }] });
  expect(await prisma.menuSale.count({ where: { organizationId: f.org.id } })).toBe(0);
  expect((await matchMenuNames(f.org.id, [{ name: '봉투', code: null }])).get('봉투')).toEqual({ kind: 'ignore' });

  const other = await createFixture();
  try {
    const foreign = await createMenu(other.org.id, { name: '남의 메뉴' });
    expect(
      await importMenuSales(f.org.id, {
        lines: [{ date: '2026-10-01', name: 'x', quantity: 1, amount: null }],
        decisions: [{ name: 'x', code: null, action: 'menu', menuId: foreign.id }],
      }),
    ).toBeNull();
    expect(await setRecipe(f.org.id, foreign.id, [])).toBe('not_found');
    await prisma.storeMenu.deleteMany({ where: { organizationId: other.org.id } });
  } finally {
    await cleanupFixture(other);
  }
});

it('reports loss between the last two Easy Counts against recipe usage', async () => {
  const americano = await createMenu(f.org.id, { name: '아메리카노' });
  await setItemContent(f.org.id, beans, { contentPerUnit: 1000, contentUnit: 'g' });
  await setRecipe(f.org.id, americano.id, [
    { itemId: beans, quantity: 20 },
    { itemId: cups, quantity: 1 },
  ]);
  await prisma.sku.update({ where: { id: beans }, data: { currentUnitCost: 20000 } });

  // 실사 한 번뿐이면 비교할 수 없다.
  const count = (date: string, beansUnits: number, beansPct: number | null, cupsUnits: number) =>
    saveEasyCount(f.org.id, {
      date,
      lines: [
        { itemId: beans, fullUnits: beansUnits, openedPercent: beansPct },
        { itemId: cups, fullUnits: cupsUnits, openedPercent: null },
      ],
      createdById: f.user.id,
    });
  await count('2026-09-30', 3, 0, 100);
  expect(await getLossReport(f.org.id, '2026-10-05')).toMatchObject({ rows: [], waiting: 2, inRecipes: 2 });

  // 10/1~10/3 판매 100잔 → 원두 2봉, 컵 100개. 10/2 컵 50개 발주.
  const sell = (date: string, quantity: number) => ({ date, name: '아메리카노', quantity, amount: null });
  await importMenuSales(f.org.id, {
    lines: [sell('2026-09-30', 999), sell('2026-10-01', 40), sell('2026-10-02', 30), sell('2026-10-03', 30)],
    decisions: [{ name: '아메리카노', code: null, action: 'menu', menuId: americano.id }],
  });
  await addPurchaseOrders(f.org.id, { date: '2026-10-02', lines: [{ itemId: cups, quantity: 50, coverageAmount: null, leftoverQuantity: null }], createdById: f.user.id });
  await count('2026-10-04', 0, 50, 50); // 원두 실제 2.5봉(+0.5, 25% 초과), 컵 실제 100개(정상)

  const report = await getLossReport(f.org.id, '2026-10-05');
  expect(report.waiting).toBe(0);
  const [first, second] = report.rows;
  expect(first.item.id).toBe(beans);
  expect(first.unitCost).toBe(20000);
  expect(first.loss).toMatchObject({ from: '2026-09-30', to: '2026-10-04', days: 4, salesDays: 3, startUnits: 3, endUnits: 0.5, orderedUnits: 0, level: 'check' });
  expect(first.loss.theoretical).toBeCloseTo(2);
  expect(first.loss.difference).toBeCloseTo(0.5);
  expect(second.item.id).toBe(cups);
  expect(second.loss).toMatchObject({ actualUsed: 100, theoretical: 100, orderedUnits: 50, difference: 0, level: 'ok' });
});
