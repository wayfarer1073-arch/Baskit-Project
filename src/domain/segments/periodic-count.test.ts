import { describe, expect, it } from 'vitest';
import { compareRecountUrgency, estimatePeriodicStock } from './periodic-count';

const opts = { stockoutSoonDays: 7 };

describe('estimatePeriodicStock', () => {
  it('projects current stock from the average usage between counts', () => {
    const r = estimatePeriodicStock(
      [{ date: '2026-09-01', quantity: 100 }, { date: '2026-09-11', quantity: 80 }],
      [],
      '2026-09-16',
      opts,
    )!;
    expect(r.dailyUsage).toBe(2);
    expect(r.daysSinceCount).toBe(5);
    expect(r.estimatedStock).toBe(70);
    expect(r.daysUntilStockout).toBe(35);
    expect(r.estimatedStockoutDate).toBe('2026-10-21');
    expect(r.status).toBe('ok');
  });

  it('adds inbound recorded between counts to usage, and inbound after the last count to the estimate', () => {
    const r = estimatePeriodicStock(
      [{ date: '2026-09-01', quantity: 100 }, { date: '2026-09-11', quantity: 120 }],
      [{ date: '2026-09-05', quantity: 50 }, { date: '2026-09-12', quantity: 30 }],
      '2026-09-16',
      opts,
    )!;
    // (100 + 50 − 120) / 10일 = 3/일, 현재 = 120 + 30 − 3×5
    expect(r.dailyUsage).toBe(3);
    expect(r.inboundSinceCount).toBe(30);
    expect(r.estimatedStock).toBe(135);
  });

  it('does not treat the day after a count as already reflected in that count', () => {
    const r = estimatePeriodicStock([{ date: '2026-09-01', quantity: 10 }, { date: '2026-09-11', quantity: 0 }], [{ date: '2026-09-12', quantity: 40 }], '2026-09-12', opts)!;
    expect(r.inboundSinceCount).toBe(40);
    expect(r.estimatedStock).toBe(39);
  });

  it('skips intervals whose increase is not explained by recorded inbound', () => {
    const r = estimatePeriodicStock(
      [{ date: '2026-09-01', quantity: 100 }, { date: '2026-09-05', quantity: 90 }, { date: '2026-09-10', quantity: 200 }],
      [],
      '2026-09-10',
      opts,
    )!;
    expect(r.usableIntervals).toBe(1);
    expect(r.dailyUsage).toBe(2.5);
  });

  it('flags estimated stock-outs and asks for a recount before ordering', () => {
    const r = estimatePeriodicStock([{ date: '2026-08-01', quantity: 50 }, { date: '2026-08-11', quantity: 30 }], [], '2026-09-01', opts)!;
    expect(r.estimatedStock).toBe(0);
    expect(r.status).toBe('estimated_out');
    expect(r.recountReasons).toEqual(['마지막 실사 후 21일 경과', '추정상 품절 임박 — 발주 전 실제 수량 확인']);
    expect(r.confidence).toBe('low');
  });

  it('cannot estimate usage from a single count', () => {
    const r = estimatePeriodicStock([{ date: '2026-09-10', quantity: 40 }], [], '2026-09-12', opts)!;
    expect(r.dailyUsage).toBeNull();
    expect(r.estimatedStock).toBeNull();
    expect(r.status).toBe('unknown');
    expect(r.confidence).toBe('none');
    expect(r.recountReasons).toContain('소진 속도를 알려면 실사가 한 번 더 필요');
  });

  it('ignores counts after the as-of date and returns null without any count', () => {
    expect(estimatePeriodicStock([{ date: '2026-09-20', quantity: 5 }], [], '2026-09-10', opts)).toBeNull();
  });

  it('orders recount candidates by urgency then staleness', () => {
    const make = (q: number, date: string) => estimatePeriodicStock([{ date: '2026-09-01', quantity: q + 10 }, { date, quantity: q }], [], '2026-09-20', opts)!;
    const ok = make(1000, '2026-09-11');
    const soon = make(10, '2026-09-11');
    const unknown = estimatePeriodicStock([{ date: '2026-09-01', quantity: 5 }], [], '2026-09-20', opts)!;
    expect([ok, unknown, soon].sort(compareRecountUrgency).map((r) => r.status)).toEqual(['soon', 'unknown', 'ok']);
  });
});
