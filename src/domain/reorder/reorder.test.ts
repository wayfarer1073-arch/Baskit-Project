import { describe, expect, it } from 'vitest';
import { DEFAULT_REORDER_POLICY, resolvePolicy, suggestReorder, turnover } from './reorder';
import { closedDays } from '@/domain/inventory/shipping-calendar';

const policy = (overrides = {}) => resolvePolicy({ ...DEFAULT_REORDER_POLICY, leadTimeDays: 2, safetyDays: 3, targetDays: 10, ...overrides });

describe('resolvePolicy', () => {
  it('takes item overrides first, then the supplier, then workspace defaults', () => {
    const p = resolvePolicy(DEFAULT_REORDER_POLICY, { leadTimeDays: 5, minOrderQty: 24 }, { leadTimeDays: 1, safetyDays: null });
    expect(p).toMatchObject({ leadTimeDays: 1, minOrderQty: 24, safetyDays: DEFAULT_REORDER_POLICY.safetyDays });
    expect(p.sources).toMatchObject({ leadTimeDays: 'item', minOrderQty: 'supplier', safetyDays: 'default' });
  });
});

describe('suggestReorder', () => {
  // 2026-09-18(금) 재고 100, 평일 하루 10개 소진.
  const base = { stock: 100, rate: 10, observedDate: '2026-09-18', asOfDate: '2026-09-18' };

  it('orders on the last working day that still lands above safety stock on arrival', () => {
    const s = suggestReorder({ ...base, policy: policy() })!;
    // 재고는 평일마다 10씩 줄어 9/29(화)에 안전재고 30이 된다. 리드타임 2일 → 9/27(일) 발주가 한계인데
    // 일요일엔 발주하지 않으므로 9/25(금). 그날 발주하면 도착(9/27) 때 50 → (목표 10 + 안전 3)×10 − 50 = 80.
    expect(s.orderDate).toBe('2026-09-25');
    expect(s.status).toBe('soon');
    expect(s.arrivalDate).toBe('2026-09-27');
    expect(s.stockAtArrival).toBe(50);
    expect(s.quantity).toBe(80);
  });

  it('flags an overdue order and sizes it as if ordering today', () => {
    const s = suggestReorder({ ...base, stock: 20, asOfDate: '2026-09-21', policy: policy() })!;
    expect(s).toMatchObject({ status: 'overdue', orderDate: '2026-09-18', arrivalDate: '2026-09-23', stockAtArrival: 0, quantity: 130 });
  });

  it('applies the minimum order quantity and rounds up to the order multiple (boxes)', () => {
    const s = suggestReorder({ ...base, stock: 60, policy: policy({ minOrderQty: 110, orderMultiple: 24 }) })!;
    // 필요량 100 → 최소 110 → 24개 단위 올림 120.
    expect(s).toMatchObject({ orderDate: '2026-09-21', quantity: 120 });
  });

  it('counts holidays as demand days when projecting', () => {
    const withHoliday = suggestReorder({ ...base, policy: policy(), calendar: closedDays(['2026-09-21', '2026-09-22']) })!;
    // 휴무일에도 주문은 쌓이므로 발주일은 휴무가 없을 때와 같다.
    expect(withHoliday.orderDate).toBe('2026-09-25');
  });

  it('gives no suggestion without a usable rate and reports long horizons as not needed', () => {
    expect(suggestReorder({ ...base, rate: null, policy: policy() })).toBeNull();
    expect(suggestReorder({ ...base, rate: 0, policy: policy() })).toBeNull();
    const far = suggestReorder({ ...base, stock: 1_000_000, rate: 1, policy: policy() })!;
    expect(far).toMatchObject({ status: 'not_needed', orderDate: null, quantity: 0 });
  });
});

describe('turnover', () => {
  it('divides depletion by average stock', () => {
    expect(turnover(300, 150)).toBe(2);
    expect(turnover(10, 0)).toBeNull();
  });
});
