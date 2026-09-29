import { describe, expect, it } from 'vitest';
import { mergeRowsAcrossWarehouses } from './merge';
import { analyzeOperationalSku } from './operational-analysis';
import { calculateInventoryValueBreakdown } from './calculations';
import { isShippingDay, shiftDate } from './shipping-calendar';
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

function series(start: number, rate: number) {
  const out = [obs('2026-09-04', start)];
  let s = start;
  for (let d = '2026-09-05'; d <= '2026-09-18'; d = shiftDate(d, 1)) if (isShippingDay(d)) out.push(obs(d, (s -= rate)));
  return out;
}

function row(code: string, warehouse: string, observations: StockObservation[], extra: Partial<SkuDescriptor> = {}): InventoryRow {
  const analysis = analyzeOperationalSku(observations, '2026-09-18')!;
  return {
    descriptor: {
      skuId: `${warehouse}-${code}`,
      warehouseId: warehouse,
      warehouseCode: warehouse,
      warehouseName: warehouse,
      productCode: code,
      productName: `상품 ${code}`,
      isSoldOut: false,
      isB2B: false,
      ...extra,
    } as SkuDescriptor,
    analysis,
    valueBreakdown: calculateInventoryValueBreakdown(analysis.latest),
    periodComparison: null,
  };
}

describe('mergeRowsAcrossWarehouses', () => {
  const settings = { stockoutSoonDays: 7, manageMaxDays: 30 };

  it('adds stock, value and usage of the same code across warehouses and recomputes coverage', () => {
    // A: 200 → 하루 10씩, B: 100 → 하루 5씩 (10출고일 후 A 100, B 50)
    const [merged] = mergeRowsAcrossWarehouses([row('P1', 'A', series(200, 10)), row('P1', 'B', series(100, 5))], settings);
    expect(merged.members.map((m) => m.warehouseName)).toEqual(['A', 'B']);
    expect(merged.totalStock).toBe(150);
    expect(merged.totalRate).toBeCloseTo(15);
    expect(merged.coverageDays).toBeCloseTo(10);
    expect(merged.risk).toBe('WARNING');
    expect(merged.totalValue).toBe(1500);
  });

  it('groups different codes that were linked, and leaves sold-out warehouses out of the totals', () => {
    const rows = [
      row('P1', 'A', series(200, 10)),
      row('X-9', 'B', series(100, 5), { mergeKey: 'P1' }),
      row('P1', 'C', series(50, 5), { isSoldOut: true }),
      row('Q', 'A', series(60, 5)),
    ];
    const merged = mergeRowsAcrossWarehouses(rows, settings);
    const p1 = merged.find((m) => m.key === 'P1')!;
    expect(p1.productCodes.sort()).toEqual(['P1', 'X-9']);
    expect(p1.members).toHaveLength(3);
    expect(p1.totalStock).toBe(150);
    // Q: 남은 10개 ÷ 하루 5개 = 2출고일 → 위험
    expect(merged[0].key).toBe('Q');
    expect(merged[0].risk).toBe('DANGER');
  });
});
