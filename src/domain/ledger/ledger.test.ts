import { describe, expect, it } from 'vitest';
import { groupByItem, ledgerFreshness, observationsFromLedger, type LedgerEntry } from './ledger';
import { closedDays, detectClosedDays, isShippingDay } from '@/domain/inventory/shipping-calendar';

const level = (date: string, quantity: number, source: 'SNAPSHOT' | 'COUNT' = 'SNAPSHOT', unitCost = 10): LedgerEntry => ({
  date,
  locationId: 'w1',
  itemId: 'i1',
  source,
  quantity,
  valuation: { unitCost, defectiveStock: 0, incomingStock: 0, warningQty: 0, dangerQty: 0 },
});
const inbound = (date: string, quantity: number): LedgerEntry => ({ date, locationId: 'w1', itemId: 'i1', source: 'INBOUND', quantity });

describe('observationsFromLedger', () => {
  it('turns level rows into date-ordered observations and attaches inbounds to their interval', () => {
    const obs = observationsFromLedger([level('2026-09-16', 80), level('2026-09-14', 100), inbound('2026-09-15', 30), level('2026-09-15', 120)]);
    expect(obs.map((o) => [o.date, o.normalStock, o.inboundQuantity])).toEqual([
      ['2026-09-14', 100, 0],
      ['2026-09-15', 120, 30],
      ['2026-09-16', 80, 0],
    ]);
  });

  it('prefers a hand count over a file snapshot on the same day and marks the source', () => {
    const obs = observationsFromLedger([level('2026-09-14', 100), level('2026-09-14', 97, 'COUNT')]);
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({ normalStock: 97, source: 'COUNT' });
  });

  it('uses the calendar for the next-business-day inbound grace', () => {
    // 금요일 관측 뒤 월요일(9/21)이 휴무면, 화요일 등록 입고가 하루 늦은 등록으로 마지막 관측에 붙는다.
    const obs = observationsFromLedger([level('2026-09-18', 50), inbound('2026-09-22', 5)], closedDays(['2026-09-21']));
    expect(obs[0].inboundQuantity).toBe(5);
  });

  it('drops stock seen on detected closed days (keeping the last observation) so their orders count toward the next shipping day', () => {
    const calendar = closedDays([], [], ['2026-09-24', '2026-09-25']);
    expect(isShippingDay('2026-09-24', calendar)).toBe(false);
    const obs = observationsFromLedger(
      [level('2026-09-23', 100), level('2026-09-24', 100), inbound('2026-09-25', 10), level('2026-09-25', 110), level('2026-09-28', 70)],
      calendar,
    );
    expect(obs.map((o) => [o.date, o.inboundQuantity])).toEqual([
      ['2026-09-23', 0],
      ['2026-09-28', 10],
    ]);
    expect(observationsFromLedger([level('2026-09-23', 100), level('2026-09-24', 100)], calendar).map((o) => o.date)).toEqual(['2026-09-23', '2026-09-24']);
  });
});

describe('detectClosedDays', () => {
  const day = (date: string, changed: number, present = 40) => ({ date, present, changed });
  it('finds weekdays when almost nothing moved in a warehouse that usually moves', () => {
    const stats = [day('2026-09-21', 16), day('2026-09-22', 14), day('2026-09-23', 12), day('2026-09-24', 0), day('2026-09-25', 1), day('2026-09-28', 20), day('2026-09-26', 0)];
    expect(detectClosedDays(stats)).toEqual(['2026-09-24', '2026-09-25']); // 토요일(09-26)은 원래 쉬는 날
    expect(detectClosedDays(stats, closedDays(['2026-09-24']))).toEqual(['2026-09-25']);
    // 평소에도 거의 안 움직이는 창고나 품목이 적은 창고는 판단하지 않는다.
    expect(detectClosedDays(stats.map((s) => ({ ...s, changed: s.changed > 1 ? 2 : 0 })))).toEqual([]);
    expect(detectClosedDays(stats.map((s) => ({ ...s, present: 5 })))).toEqual([]);
  });
});

describe('ledgerFreshness', () => {
  it('reports the last level row and the last hand count up to the date', () => {
    const entries = [level('2026-09-10', 1, 'COUNT'), level('2026-09-14', 1), level('2026-09-20', 1, 'COUNT')];
    expect(ledgerFreshness(entries, '2026-09-15')).toEqual({ lastLevelDate: '2026-09-14', lastLevelSource: 'SNAPSHOT', lastCountDate: '2026-09-10' });
    expect(ledgerFreshness([], '2026-09-15')).toEqual({ lastLevelDate: null, lastLevelSource: null, lastCountDate: null });
  });

  it('groups a mixed ledger by item', () => {
    const grouped = groupByItem([level('2026-09-10', 1), { ...level('2026-09-10', 2), itemId: 'i2' }]);
    expect([...grouped.keys()]).toEqual(['i1', 'i2']);
  });
});
