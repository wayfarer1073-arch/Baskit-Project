import { describe, expect, it } from 'vitest';
import { compareLoss, countIntervalLoss, lossLevel } from './loss-report';

const usage = new Map([
  ['2026-09-28', 0.5], // 앞 실사일 — 실사에 이미 들어 있다
  ['2026-09-29', 0.4],
  ['2026-09-30', 0.4],
  ['2026-10-01', 0.4],
  ['2026-10-02', 0.4],
]);
const sales = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];

describe('loss report', () => {
  it('compares actual usage between two counts with recipe usage', () => {
    const loss = countIntervalLoss(
      { date: '2026-09-28', fullUnits: 2, openedPercent: 50 },
      { date: '2026-10-02', fullUnits: 1, openedPercent: 25 },
      [
        { date: '2026-09-28', quantity: 9 }, // 앞 실사일 발주 — 센 재고에 들어 있다
        { date: '2026-10-01', quantity: 1 },
      ],
      usage,
      sales,
    );
    expect(loss).toMatchObject({ from: '2026-09-28', to: '2026-10-02', days: 4, salesDays: 4, startUnits: 2.5, orderedUnits: 1, endUnits: 1.25 });
    expect(loss.actualUsed).toBeCloseTo(2.25);
    expect(loss.theoretical).toBeCloseTo(1.6);
    expect(loss.difference).toBeCloseTo(0.65);
    expect(loss.rate).toBeCloseTo(0.40625);
    expect(loss.level).toBe('check');
  });

  it('grades by rate, tolerates eye-estimated opened amounts, and flags missing sales', () => {
    expect(lossLevel(0.4, 10, 5)).toBe('ok');
    expect(lossLevel(1, 10, 5)).toBe('watch');
    expect(lossLevel(-2, 10, 5)).toBe('check');
    expect(lossLevel(0.08, 0.2, 5)).toBe('ok'); // 비율은 40%지만 0.1단위 이내
    expect(lossLevel(1, 0, 0)).toBe('no_sales');
    expect(lossLevel(1, 0, 3)).toBe('check');
  });

  it('sorts the biggest problems first', () => {
    const at = (difference: number, theoretical: number, unitCost: number | null) => ({
      unitCost,
      loss: countIntervalLoss(
        { date: '2026-10-01', fullUnits: theoretical + difference, openedPercent: null },
        { date: '2026-10-02', fullUnits: 0, openedPercent: null },
        [],
        new Map([['2026-10-02', theoretical]]),
        ['2026-10-02'],
      ),
    });
    const rows = [at(0, 10, 1000), at(3, 10, 1000), at(5, 10, 100), at(1, 10, 1000)];
    expect(rows.sort(compareLoss).map((r) => [r.loss.level, r.loss.difference])).toEqual([
      ['check', 3],
      ['check', 5],
      ['watch', 1],
      ['ok', 0],
    ]);
  });
});
