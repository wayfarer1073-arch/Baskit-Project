import { describe, expect, it } from 'vitest';
import { addDays, format, parseISO } from 'date-fns';
import { compareOrderUrgency, forecastNextOrder, salesGrowthFactor, summarizeSales } from './order-cycle';

function days(from: string, count: number, amount: (i: number) => number) {
  return Array.from({ length: count }, (_, i) => ({ date: format(addDays(parseISO(from), i), 'yyyy-MM-dd'), amount: amount(i) }));
}

describe('forecastNextOrder', () => {
  const weekly = [
    { date: '2026-08-03', quantity: 14 },
    { date: '2026-08-10', quantity: 14 },
    { date: '2026-08-17', quantity: 14 },
    { date: '2026-08-24', quantity: 14 },
    { date: '2026-08-31', quantity: 14 },
  ];

  it('derives daily usage from the quantity consumed between orders', () => {
    const f = forecastNextOrder(weekly, [], '2026-09-03', 1);
    expect(f.baseDailyUsage).toBe(2);
    expect(f.avgIntervalDays).toBe(7);
    expect(f.expectedRunOutDate).toBe('2026-09-07');
    expect(f.recommendedOrderDate).toBe('2026-09-06');
    expect(f.daysUntilOrder).toBe(3);
    expect(f.recommendedQuantity).toBe(14);
    expect(f.status).toBe('ok');
    expect(f.confidence).toBe('high');
  });

  it('pulls the next order forward when recent sales are growing', () => {
    const sales = [...days('2026-08-03', 28, () => 100_000), ...days('2026-09-01', 7, () => 150_000)];
    const f = forecastNextOrder(weekly, sales, '2026-09-07', 1);
    expect(f.salesGrowthFactor).not.toBeNull();
    expect(f.salesGrowthFactor!).toBeGreaterThan(1);
    expect(f.adjustedDailyUsage!).toBeGreaterThan(2);
    expect(f.recommendedOrderDate! < '2026-09-06').toBe(true);
    expect(f.recommendedQuantity!).toBeGreaterThan(14);
  });

  it('does not adjust for sales when too few days were recorded', () => {
    const f = forecastNextOrder(weekly, days('2026-09-01', 3, () => 999_999), '2026-09-03', 1);
    expect(f.salesGrowthFactor).toBeNull();
    expect(f.adjustedDailyUsage).toBe(2);
  });

  it('marks orders past the recommended date as overdue and stale items as dormant', () => {
    expect(forecastNextOrder(weekly, [], '2026-09-08', 1).status).toBe('overdue');
    expect(forecastNextOrder(weekly, [], '2026-09-06', 1).status).toBe('today');
    expect(forecastNextOrder(weekly, [], '2026-09-05', 1).status).toBe('soon');
    expect(forecastNextOrder(weekly, [], '2026-10-15', 1).status).toBe('dormant');
  });

  it('needs at least two order dates and merges same-day orders', () => {
    expect(forecastNextOrder([{ date: '2026-09-01', quantity: 5 }], [], '2026-09-03', 1).status).toBe('insufficient');
    const f = forecastNextOrder([{ date: '2026-09-01', quantity: 5 }, { date: '2026-09-01', quantity: 5 }, { date: '2026-09-11', quantity: 4 }], [], '2026-09-12', 0);
    expect(f.orderCount).toBe(2);
    expect(f.baseDailyUsage).toBe(1);
  });

  it('keeps fractional units for weight-based items and rates irregular cycles lower', () => {
    const f = forecastNextOrder(
      [{ date: '2026-08-01', quantity: 2.5 }, { date: '2026-08-04', quantity: 2.5 }, { date: '2026-08-20', quantity: 2.5 }],
      [],
      '2026-08-21',
      1,
    );
    expect(Number.isInteger(f.recommendedQuantity)).toBe(false);
    expect(f.confidence).toBe('low');
  });
});

describe('sales helpers', () => {
  it('clamps extreme growth factors', () => {
    const sales = [...days('2026-08-01', 10, () => 10_000), ...days('2026-09-01', 10, () => 1_000_000)];
    expect(salesGrowthFactor(sales, '2026-08-01', '2026-08-10', '2026-09-10')).toBe(2);
  });

  it('compares the last four weeks with the four before and buckets weeks from Monday', () => {
    const sales = [...days('2026-07-23', 28, () => 100), ...days('2026-08-20', 28, () => 120)];
    const t = summarizeSales(sales, '2026-09-16', 4);
    expect(t.growthRate).toBeCloseTo(0.2);
    expect(t.weekly).toHaveLength(4);
    expect(t.weekly.at(-1)!.weekStart).toBe('2026-09-14');
  });

  it('sorts urgent items first', () => {
    const a = forecastNextOrder([{ date: '2026-09-01', quantity: 7 }, { date: '2026-09-08', quantity: 7 }], [], '2026-09-20', 0);
    const b = forecastNextOrder([{ date: '2026-09-10', quantity: 7 }, { date: '2026-09-17', quantity: 7 }], [], '2026-09-20', 0);
    expect([b, a].sort(compareOrderUrgency).map((f) => f.status)).toEqual(['overdue', 'ok']);
  });
});
