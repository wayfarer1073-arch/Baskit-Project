import { describe, expect, it } from 'vitest';
import { comparePeriodicRange, compareStoreRange, rangeDays } from './range-compare';
import type { PeriodicRow } from './read-model';
import type { PeriodicEstimate } from './periodic-count';

const row = (skuId: string, estimate: Partial<PeriodicEstimate>): PeriodicRow => ({
  skuId,
  warehouseId: 'w',
  warehouseCode: 'W',
  warehouseName: '창고',
  productCode: skuId,
  productName: `상품 ${skuId}`,
  estimate: {
    lastCountDate: '2026-09-01',
    lastCountQuantity: 10,
    daysSinceCount: 0,
    usableIntervals: 1,
    dailyUsage: 1,
    inboundSinceCount: 0,
    estimatedStock: 10,
    daysUntilStockout: 10,
    estimatedStockoutDate: null,
    status: 'ok',
    confidence: 'medium',
    reliability: null,
    recountReasons: [],
    ...estimate,
  },
});

describe('rangeDays', () => {
  it('시작일과 종료일을 모두 센다', () => expect(rangeDays('2026-09-01', '2026-09-07')).toBe(7));
});

describe('comparePeriodicRange', () => {
  it('같은 SKU끼리 추정 재고 변화를 세고, 기간 중 실사·새 품절·회복을 센다', () => {
    const from = [row('A', { estimatedStock: 50 }), row('B', { estimatedStock: 0, status: 'estimated_out' }), row('C', { estimatedStock: 5 })];
    const to = [
      row('A', { estimatedStock: 20 }),
      row('B', { estimatedStock: 30, lastCountDate: '2026-09-05' }),
      row('C', { estimatedStock: 0, status: 'estimated_out' }),
      row('D', { estimatedStock: 8, lastCountDate: '2026-09-06' }),
    ];
    const s = comparePeriodicRange(from, to, '2026-09-01', '2026-09-07');
    expect(s.fromStock).toBe(55);
    expect(s.toStock).toBe(50);
    expect(s.countedSkus).toBe(2);
    expect(s.newlyOut).toBe(1);
    expect(s.recovered).toBe(1);
    expect(s.rows.map((r) => [r.skuId, r.change])).toEqual([
      ['A', -30],
      ['B', 30],
      ['C', -5],
      ['D', null],
    ]);
  });
});

describe('compareStoreRange', () => {
  it('기간 매출·직전 같은 길이 기간 대비 변화·기간 중 발주를 정리한다', () => {
    const sales = [
      { date: '2026-08-30', amount: 100 },
      { date: '2026-08-31', amount: 100 },
      { date: '2026-09-01', amount: 150 },
      { date: '2026-09-02', amount: 150 },
    ];
    const items = [
      {
        id: 'milk',
        name: '우유',
        unit: '팩',
        orders: [
          { date: '2026-09-01', quantity: 5 },
          { date: '2026-09-02', quantity: 3 },
          { date: '2026-08-30', quantity: 9 },
        ],
      },
      { id: 'bean', name: '원두', unit: '봉', orders: [{ date: '2026-08-15', quantity: 2 }] },
    ];
    const s = compareStoreRange(items, sales, '2026-09-01', '2026-09-02');
    expect(s).toMatchObject({ days: 2, salesTotal: 300, salesDays: 2, dailyAverage: 150, changePct: 50, orderCount: 2 });
    expect(s.previous).toMatchObject({ from: '2026-08-30', to: '2026-08-31', salesTotal: 200 });
    expect(s.items).toEqual([{ itemId: 'milk', name: '우유', unit: '팩', orderCount: 2, quantity: 8 }]);
  });
});
