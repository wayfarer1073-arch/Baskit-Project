import { describe, expect, it } from 'vitest';
import { addDays, format, parseISO } from 'date-fns';
import { analyzeCoverage, blendCoverage, compareCoverageUrgency, describeUnits, suggestCoverage, summarizeSales } from './sales-coverage';

function daily(from: string, count: number, amount: number | ((i: number) => number)) {
  return Array.from({ length: count }, (_, i) => ({ date: format(addDays(parseISO(from), i), 'yyyy-MM-dd'), amount: typeof amount === 'number' ? amount : amount(i) }));
}

describe('analyzeCoverage — current order', () => {
  it('counts sales since the order against the entered coverage', () => {
    const a = analyzeCoverage([{ date: '2026-09-01', quantity: 10, coverageAmount: 1_000_000, leftoverQuantity: null }], daily('2026-09-01', 5, 100_000), '2026-09-05', 1);
    expect(a.estimate).toMatchObject({ amount: 1_000_000, source: 'entered' });
    expect(a.consumedSales).toBe(500_000);
    expect(a.progress).toBe(0.5);
    expect(a.status).toBe('ok');
    // 남은 50만 − 확인 여유(20만) = 30만 ÷ 하루 10만 → 3일 뒤 확인 필요
    expect(a.expectedCheckDate).toBe('2026-09-08');
  });

  it('asks for a check when the remaining coverage falls under 20% (or lead-time sales) and flags an order when used up', () => {
    const order = [{ date: '2026-09-01', quantity: 10, coverageAmount: 1_000_000, leftoverQuantity: null }];
    expect(analyzeCoverage(order, daily('2026-09-01', 8, 100_000), '2026-09-08', 1).status).toBe('check_needed');
    expect(analyzeCoverage(order, daily('2026-09-01', 10, 100_000), '2026-09-10', 1).status).toBe('order_needed');
    // 리드타임 4일이면 하루 10만 × 4 = 40만 여유가 필요 → 60만 쓴 시점에 이미 확인 필요
    expect(analyzeCoverage(order, daily('2026-09-01', 6, 100_000), '2026-09-06', 4).status).toBe('check_needed');
  });

  it('fills past days without a sales entry with the recent average so a forgotten entry does not hide a shortage', () => {
    const sales = [...daily('2026-08-20', 12, 100_000), { date: '2026-09-01', amount: 100_000 }];
    const a = analyzeCoverage([{ date: '2026-09-01', quantity: 10, coverageAmount: 1_000_000, leftoverQuantity: null }], sales, '2026-09-05', 1);
    expect(a.recordedSales).toBe(100_000);
    expect(a.missingSalesDays).toBe(3); // 9/2~9/4 (오늘 9/5는 아직 입력 전일 수 있어 제외)
    expect(a.consumedSales).toBe(400_000);
  });

  it('treats an item that sold three times its coverage without a reorder as no longer used, not as the most urgent order', () => {
    const order = [{ date: '2026-09-01', quantity: 1, coverageAmount: 100_000, leftoverQuantity: null }];
    const stale = analyzeCoverage(order, daily('2026-09-01', 4, 100_000), '2026-09-04', 1);
    expect(stale.status).toBe('dormant');
    const urgent = analyzeCoverage(order, daily('2026-09-01', 2, 100_000), '2026-09-02', 1);
    expect(urgent.status).toBe('order_needed');
    expect(compareCoverageUrgency(urgent, stale)).toBeLessThan(0);
  });

  it('needs a coverage amount when nothing was entered and nothing is learned yet', () => {
    const a = analyzeCoverage([{ date: '2026-09-01', quantity: 10, coverageAmount: null, leftoverQuantity: null }], daily('2026-09-01', 3, 50_000), '2026-09-03', 1);
    expect(a.status).toBe('needs_coverage');
    expect(analyzeCoverage([], [], '2026-09-03', 1).status).toBe('no_orders');
  });
});

describe('analyzeCoverage — learning from completed orders', () => {
  // 10개 발주가 실제로는 매번 80만원어치 매출을 감당했다(사용자는 100만으로 과대 입력).
  const orders = [
    { date: '2026-08-01', quantity: 10, coverageAmount: 1_000_000, leftoverQuantity: null },
    { date: '2026-08-09', quantity: 10, coverageAmount: 1_000_000, leftoverQuantity: null },
    { date: '2026-08-17', quantity: 10, coverageAmount: 1_000_000, leftoverQuantity: null },
    { date: '2026-08-25', quantity: 10, coverageAmount: 1_000_000, leftoverQuantity: null },
  ];
  const sales = daily('2026-08-01', 30, 100_000);

  it('learns sales per unit from what each order actually covered', () => {
    const a = analyzeCoverage(orders, sales, '2026-08-26', 1);
    expect(a.cycles).toHaveLength(3);
    expect(a.cycles.map((c) => c.realizedSales)).toEqual([800_000, 800_000, 800_000]);
    expect(a.salesPerUnit).toBe(80_000);
    expect(a.learnedCycles).toBe(3);
  });

  it('shifts weight from the entered amount to the learned amount as cycles accumulate', () => {
    const a = analyzeCoverage(orders, sales, '2026-08-26', 1);
    // 학습 3회 → 가중치 3/5: 0.6×80만 + 0.4×100만
    expect(a.estimate.source).toBe('blended');
    expect(a.estimate.amount).toBeCloseTo(880_000);
    const errors = a.cycles.map((c) => Math.abs(c.systemError ?? 0));
    expect(errors[2]).toBeLessThan(errors[0]);
    expect(a.cycles[0].enteredError).toBeCloseTo(0.25);
  });

  it('suggests a coverage amount for a new order quantity from the learned rate', () => {
    expect(suggestCoverage(orders, sales, '2026-08-26', 5)).toEqual({ amount: 400_000, cycles: 3 });
    expect(suggestCoverage(orders.slice(0, 1), sales, '2026-08-26', 5)).toBeNull();
  });

  it('skips cycles with too few sales entries and scales partially recorded ones', () => {
    const sparse = [...daily('2026-08-01', 4, 100_000)]; // 8일 중 4일만 입력 → 딱 50%, 8일치로 환산
    const a = analyzeCoverage(orders.slice(0, 2), sparse, '2026-08-10', 1);
    expect(a.cycles[0].realizedSales).toBe(800_000);
    const tooSparse = analyzeCoverage(orders.slice(0, 2), daily('2026-08-01', 2, 100_000), '2026-08-10', 1);
    expect(tooSparse.cycles[0].realizedSales).toBeNull();
    expect(tooSparse.salesPerUnit).toBeNull();
  });
});

describe('helpers', () => {
  it('blends only what is available', () => {
    expect(blendCoverage(null, null, 0).source).toBe('none');
    expect(blendCoverage(null, 500, 1)).toEqual({ amount: 500, source: 'learned', learnedWeight: 1 });
  });

  it('orders urgent items first', () => {
    const order = [{ date: '2026-09-01', quantity: 10, coverageAmount: 1_000_000, leftoverQuantity: null }];
    const ok = analyzeCoverage(order, daily('2026-09-01', 2, 100_000), '2026-09-02', 1);
    const needed = analyzeCoverage(order, daily('2026-09-01', 11, 100_000), '2026-09-11', 1);
    expect([ok, needed].sort(compareCoverageUrgency).map((a) => a.status)).toEqual(['order_needed', 'ok']);
  });

  it('compares the last four weeks with the four before and buckets weeks from Monday', () => {
    const t = summarizeSales([...daily('2026-07-23', 28, 100), ...daily('2026-08-20', 28, 120)], '2026-09-16', 4);
    expect(t.growthRate).toBeCloseTo(0.2);
    expect(t.weekly.at(-1)!.weekStart).toBe('2026-09-14');
  });
});

describe('leftover at reorder', () => {
  const sales = daily('2026-08-01', 30, 100_000);

  it('learns from the units actually used when the leftover at reorder is recorded', () => {
    // 10개 발주, 8일 뒤 2개 남은 상태로 재발주 → 8개로 80만 매출 = 개당 10만
    const orders = [
      { date: '2026-08-01', quantity: 10, coverageAmount: 700_000, leftoverQuantity: null },
      { date: '2026-08-09', quantity: 10, coverageAmount: 700_000, leftoverQuantity: 2 },
    ];
    const a = analyzeCoverage(orders, sales, '2026-08-10', 1);
    expect(a.cycles[0]).toMatchObject({ openingUnits: 10, leftoverAtNext: 2, consumedUnits: 8, realizedSales: 800_000, overrunSales: 100_000 });
    expect(a.salesPerUnit).toBe(100_000);
    // 지금 쓸 수 있는 양 = 잔량 2 + 발주 10 = 12개
    expect(a.openingUnits).toBe(12);
    // 입력 70만(1/3 학습) … 학습값 120만과 섞임: 1/3×120만 + 2/3×70만
    expect(a.estimate.amount).toBeCloseTo(866_667, -1);
    // 발주 후 매출 20만(9, 10일) → 12 − 2 = 10개 남음
    expect(a.estimatedRemainingUnits).toBeCloseTo(10);
  });

  it('records when sales passed the entered coverage and how many days later the reorder came', () => {
    const orders = [
      { date: '2026-08-01', quantity: 10, coverageAmount: 500_000, leftoverQuantity: null },
      { date: '2026-08-09', quantity: 10, coverageAmount: 500_000, leftoverQuantity: 1.5 },
    ];
    const a = analyzeCoverage(orders, sales, '2026-08-10', 1);
    expect(a.cycles[0].crossedDate).toBe('2026-08-05');
    expect(a.cycles[0].daysAfterCross).toBe(4);
    expect(a.habit).toMatchObject({ cyclesWithEntry: 1, avgDaysAfterCross: 4, avgLeftoverAtReorder: 1.5 });
    expect(a.habit.avgOverrunRatio).toBeCloseTo(0.6);
  });

  it('includes the leftover in the suggested coverage and describes partial units', () => {
    const orders = [
      { date: '2026-08-01', quantity: 10, coverageAmount: null, leftoverQuantity: null },
      { date: '2026-08-11', quantity: 10, coverageAmount: null, leftoverQuantity: 0 },
    ];
    expect(suggestCoverage(orders, sales, '2026-08-12', 10, 2)).toEqual({ amount: 1_200_000, cycles: 1 });
    expect(describeUnits(2.4, '봉')).toBe('2봉 + 마지막 봉의 약 40%');
    expect(describeUnits(0.3, '봉')).toBe('마지막 봉의 약 30%');
    expect(describeUnits(3, '봉')).toBe('3봉');
  });
});
