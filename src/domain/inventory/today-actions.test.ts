import { describe, expect, it } from 'vitest';
import { buildTodayActions } from './today-actions';
import { analyzeOperationalSku } from './operational-analysis';
import { calculateInventoryValueBreakdown } from './calculations';
import { isShippingDay, shiftDate } from './shipping-calendar';
import { DEFAULT_REORDER_POLICY, resolvePolicy, suggestReorder } from '@/domain/reorder/reorder';
import type { InventoryRow, SkuDescriptor } from './read-model';
import type { StockObservation } from './types';

const obs = (date: string, stock: number): StockObservation => ({
  date,
  normalStock: stock,
  availableStock: stock,
  unitCost: 10,
  defectiveStock: 0,
  incomingStock: 0,
  warningQty: 0,
  dangerQty: 0,
  inboundQuantity: 0,
});

function series(start: number, rate: number, to = '2026-09-18') {
  const out = [obs('2026-09-04', start)];
  let s = start;
  for (let d = '2026-09-05'; d <= to; d = shiftDate(d, 1)) if (isShippingDay(d)) out.push(obs(d, (s -= rate)));
  return out;
}

function row(code: string, observations: StockObservation[], asOf = '2026-09-18'): InventoryRow {
  const analysis = analyzeOperationalSku(observations, asOf)!;
  const descriptor = {
    skuId: code,
    warehouseId: 'w',
    warehouseCode: 'A',
    warehouseName: 'Main',
    productCode: code,
    productName: code,
    isSoldOut: false,
    isB2B: false,
    firstSeenDate: '2026-09-04',
  } as SkuDescriptor;
  const rate = analysis.operating?.reason === null ? analysis.window7.averageDailyDepletion : null;
  return {
    descriptor,
    analysis,
    valueBreakdown: calculateInventoryValueBreakdown(analysis.latest),
    periodComparison: null,
    reorder: suggestReorder({
      stock: analysis.latest.normalStock,
      rate,
      observedDate: analysis.latest.date,
      asOfDate: asOf,
      policy: resolvePolicy({ ...DEFAULT_REORDER_POLICY, leadTimeDays: 3, safetyDays: 3, targetDays: 10 }),
    }),
  };
}

describe('buildTodayActions', () => {
  it('puts orders that are due first, stockout-before-arrival at the very top, then upcoming orders', () => {
    // 9/18(금) 기준, 평일 하루 10개, 리드타임 3일(월요일 도착), 안전재고 30.
    const urgent = row('URGENT', series(105, 10)); // 마지막 재고 5 → 월요일 도착 전 품절
    const due = row('DUE', series(140, 10)); // 40 → 도착 때 30, 오늘 발주
    const soon = row('SOON', series(200, 10)); // 100 → 다음 주 금요일 발주
    const plenty = row('PLENTY', series(2000, 10));
    const actions = buildTodayActions([plenty, soon, due, urgent], '2026-09-18', 30);
    expect(actions.map((x) => [x.skuId, x.kind])).toEqual([
      ['URGENT', 'order_now'],
      ['DUE', 'order_now'],
      ['SOON', 'order_soon'],
    ]);
    expect(actions[0].stockoutBeforeArrival).toBe(true);
    expect(actions[1].quantity).toBeGreaterThan(0);
  });

  it('asks to check stale data instead of suggesting an order from it', () => {
    const stale = row('STALE', series(130, 10), '2026-09-22');
    const actions = buildTodayActions([stale], '2026-09-22', 30);
    expect(actions).toEqual([expect.objectContaining({ skuId: 'STALE', kind: 'check_data', reason: '자료 갱신 필요' })]);
  });
});
