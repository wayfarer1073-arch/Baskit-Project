import { describe, expect, it } from 'vitest';
import { estimateStock, recipeUsage, toItemUnits, type RecipeItem, type RecipeMenu } from './recipe-usage';

const beans: RecipeItem = { id: 'beans', name: '원두', unit: '봉', contentPerUnit: 1000, contentUnit: 'g' };
const cups: RecipeItem = { id: 'cups', name: '컵', unit: '개', contentPerUnit: null, contentUnit: null };
const milk: RecipeItem = { id: 'milk', name: '우유', unit: '팩', contentPerUnit: 1000, contentUnit: 'ml' };
const menus: RecipeMenu[] = [
  {
    id: 'ame',
    name: '아메리카노',
    lines: [
      { itemId: 'beans', quantity: 18 },
      { itemId: 'cups', quantity: 1 },
    ],
  },
  {
    id: 'latte',
    name: '카페라떼',
    lines: [
      { itemId: 'beans', quantity: 18 },
      { itemId: 'milk', quantity: 200 },
      { itemId: 'cups', quantity: 1 },
    ],
  },
  { id: 'cookie', name: '쿠키', lines: [] },
];

describe('recipe usage', () => {
  it('converts recipe amounts into item units', () => {
    expect(toItemUnits(beans, 18)).toBeCloseTo(0.018);
    expect(toItemUnits(cups, 2)).toBe(2);
  });

  it('multiplies sales by recipes within the period and flags menus without a recipe', () => {
    const sales = [
      { menuId: 'ame', date: '2026-10-01', quantity: 50 },
      { menuId: 'latte', date: '2026-10-01', quantity: 20 },
      { menuId: 'latte', date: '2026-10-02', quantity: 10 },
      { menuId: 'cookie', date: '2026-10-02', quantity: 6 },
      { menuId: 'ame', date: '2026-09-20', quantity: 999 }, // 기간 밖
    ];
    const { items, menusWithoutRecipe } = recipeUsage([beans, cups, milk], menus, sales, '2026-10-01', '2026-10-02');
    expect(items.get('beans')!.content).toBe(80 * 18);
    expect(items.get('beans')!.units).toBeCloseTo(1.44);
    expect(items.get('cups')!.units).toBe(80);
    expect(items.get('cups')!.content).toBeNull();
    expect(items.get('milk')!.units).toBeCloseTo(6);
    expect(items.get('milk')!.byDate.get('2026-10-02')).toBeCloseTo(2);
    expect(menusWithoutRecipe).toEqual([{ menuId: 'cookie', name: '쿠키', quantity: 6 }]);
  });

  it('estimates stock from the last count, later orders and usage', () => {
    const usage = new Map([
      ['2026-10-01', 2],
      ['2026-10-02', 3],
      ['2026-10-03', 4],
    ]);
    const orders = [
      { date: '2026-10-01', quantity: 12 }, // 센 날의 발주 — 센 재고에 들어 있다
      { date: '2026-10-02', quantity: 6 },
    ];
    expect(estimateStock({ date: '2026-10-01', fullUnits: 10, openedPercent: 50 }, orders, usage, '2026-10-03')).toEqual({
      baseDate: '2026-10-01',
      baseUnits: 10.5,
      orderedSince: 6,
      usedSince: 7,
      estimatedUnits: 9.5,
    });
    expect(estimateStock({ date: '2026-10-01', fullUnits: 1, openedPercent: null }, [], usage, '2026-10-03')!.estimatedUnits).toBe(0);
    expect(estimateStock(null, orders, usage, '2026-10-03')).toBeNull();
  });
});
