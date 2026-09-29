import { describe, expect, it } from 'vitest';
import { groupByItem, ledgerFreshness, observationsFromLedger, type LedgerEntry } from './ledger';
import { closedDays } from '@/domain/inventory/shipping-calendar';

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
