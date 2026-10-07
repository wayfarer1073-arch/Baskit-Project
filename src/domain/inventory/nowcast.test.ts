import { describe, expect, it } from 'vitest';
import { demandDaySeries, demandPattern, forecastReliability, gradeOf, maskBulkDays, nowcastStock } from './nowcast';
import { closedDays, isDemandDay, isShippingDay, shiftDate, type ClosedDays } from './shipping-calendar';
import type { StockObservation } from './types';

const obs = (date: string, stock: number, inbound = 0): StockObservation => ({
  date,
  normalStock: stock,
  availableStock: stock,
  unitCost: 10,
  defectiveStock: 0,
  incomingStock: 0,
  warningQty: 0,
  dangerQty: 0,
  inboundQuantity: inbound,
});

/** 평일마다 rate(date)만큼 주문이 들어오고, 출고일마다 쌓인 주문이 빠진다(업로드도 그날). */
function history(rate: (date: string) => number, from: string, to: string, start: number, holidays: ClosedDays = closedDays([])) {
  const result: StockObservation[] = [obs(from, start)];
  let stock = start;
  let backlog = 0;
  for (let d = shiftDate(from, 1); d <= to; d = shiftDate(d, 1)) {
    if (!isDemandDay(d, holidays)) continue;
    backlog += rate(d);
    if (isShippingDay(d, holidays)) {
      stock -= backlog;
      backlog = 0;
      result.push(obs(d, stock));
    }
  }
  return result;
}

function nowcastAt(observations: StockObservation[], asOfDate: string, extra: { isB2B?: boolean; isSoldOut?: boolean; holidays?: ClosedDays } = {}) {
  return nowcastStock({ observations, asOfDate, ...extra })!;
}

describe('demandDaySeries', () => {
  it('spreads a multi-day interval evenly over its demand days and blanks unexplained increases', () => {
    const series = demandDaySeries([obs('2026-09-10', 100), obs('2026-09-11', 90), obs('2026-09-15', 60), obs('2026-09-16', 80)]);
    expect(series.map((d) => d.date)).toEqual(['2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16']);
    expect(series.map((d) => d.value)).toEqual([10, 15, 15, null]);
    expect(series[1].weekday).toBe(1);
  });
});

describe('nowcastStock', () => {
  const steady = history(() => 10, '2026-07-01', '2026-09-25', 2000);

  it('subtracts the predicted depletion for each elapsed demand day from the last upload', () => {
    // 금요일 자료 뒤 월·화 미업로드 → 2 수요일
    const n = nowcastAt(steady, '2026-09-29');
    expect(n.status).toBe('estimated');
    expect(n.lastObservedDate).toBe('2026-09-25');
    expect(n.elapsedDays).toBe(4);
    expect(n.horizonDays).toBe(2);
    expect(n.estimatedStock).toBe(n.lastObservedStock - 20);
    expect(n.backtest!.wape).toBeLessThan(0.01);
    expect(n.low).toBeLessThanOrEqual(n.estimatedStock!);
    expect(n.high).toBeGreaterThanOrEqual(n.estimatedStock!);
  });

  it('learns a weekday pattern when there is enough history', () => {
    // 월요일엔 30, 나머지 평일엔 10
    const weekly = history((d) => (new Date(`${d}T00:00:00Z`).getUTCDay() === 1 ? 30 : 10), '2026-06-01', '2026-09-25', 4000);
    const monday = nowcastAt(weekly, '2026-09-28');
    expect(monday.method).toBe('ewma_weekday');
    // 요일 계수 없이 평균만 쓰면 월요일도 14 안팎이다.
    expect(monday.expectedDepletion).toBeGreaterThan(26);
    expect(monday.expectedDepletion).toBeLessThan(32);
    const tuesday = nowcastAt(weekly, '2026-09-29');
    expect(tuesday.expectedDepletion! - monday.expectedDepletion!).toBeGreaterThan(8);
    expect(tuesday.expectedDepletion! - monday.expectedDepletion!).toBeLessThan(12);
  });

  it('does not count a holiday whose orders have not shipped yet', () => {
    const holidays = closedDays(['2026-09-28']);
    const n = nowcastAt(steady, '2026-09-28', { holidays });
    expect(n.horizonDays).toBe(0);
    expect(n.estimatedStock).toBe(n.lastObservedStock);
  });

  it('grades by the error of a backtest as long as the actual gap, and refuses only very irregular items', () => {
    expect(gradeOf(0.1)).toBe('HIGH');
    expect(gradeOf(0.2)).toBe('MEDIUM');
    expect(gradeOf(0.4)).toBe('LOW');
    expect(gradeOf(0.6)).toBeNull();
    let seed = 7;
    const noise = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    // 거의 매일 나가지만 양이 들쭉날쭉한 품목은 같은 길이로 되짚어 맞히지 못하면 추정하지 않는다.
    const erratic = history(() => Math.round(noise() ** 3 * 400), '2026-07-01', '2026-09-25', 20000);
    const noisy = nowcastAt(erratic, '2026-09-29');
    expect(['unstable_pattern', 'insufficient_history']).toContain(noisy.reason);
    expect(noisy.estimatedStock).toBeNull();
    const n = nowcastAt(steady, '2026-09-29');
    expect(n.grade).toBe('HIGH');
    expect(n.backtest!.horizon).toBe(2);
  });

  it('keeps estimating across long gaps (beyond a week) and stops only past 30 demand days or half the history', () => {
    const twoWeeks = nowcastAt(steady, '2026-10-09');
    expect(twoWeeks.status).toBe('estimated');
    expect(twoWeeks.horizonDays).toBe(10);
    expect(twoWeeks.estimatedStock).toBe(twoWeeks.lastObservedStock - 100);
    expect(twoWeeks.backtest!.horizon).toBe(10);
    expect(nowcastAt(steady, '2026-11-20').reason).toBe('gap_too_long');
    // 6주 자료뿐이면 공백은 그 절반(평일 15일)까지만.
    const short = history(() => 10, '2026-08-14', '2026-09-25', 1000);
    expect(nowcastAt(short, '2026-10-16').status).toBe('estimated');
    expect(nowcastAt(short, '2026-10-19').reason).toBe('gap_too_long');
  });

  it('does not let unexplained increases (unrecorded inbound) block the estimate', () => {
    // 10번째 업로드마다 입고 기록 없이 재고가 500씩 늘어난다.
    let added = 0;
    const shifted = steady.map((o, i) => {
      if (i > 0 && i % 10 === 0) added += 500;
      return { ...o, normalStock: o.normalStock + added, availableStock: o.availableStock + added };
    });
    const n = nowcastAt(shifted, '2026-09-29');
    expect(n.status).toBe('estimated');
    expect(n.expectedDepletion).toBeCloseTo(20, 0);
  });

  it('refuses special, sold-out and integrity-problem items', () => {
    expect(nowcastAt(steady, '2026-09-29', { isB2B: true }).reason).toBe('special');
    expect(nowcastAt(steady, '2026-09-29', { isSoldOut: true }).reason).toBe('sold_out');
    const negative = [...steady.slice(0, -1), obs('2026-09-24', -5), steady[steady.length - 1]];
    expect(nowcastAt(negative, '2026-09-29').reason).toBe('integrity');
    expect(nowcastAt(steady.slice(-8), '2026-09-29').reason).toBe('insufficient_history');
  });

  it('shows items without recent depletion as unchanged rather than unpredictable', () => {
    const flat = history(() => 0, '2026-07-01', '2026-09-25', 500);
    const n = nowcastAt(flat, '2026-10-09');
    expect(n.status).toBe('flat');
    expect(n.estimatedStock).toBe(500);
  });

  it('never estimates below zero', () => {
    const low = history(() => 10, '2026-07-01', '2026-09-25', 680);
    // 마지막 재고 60, 10월 6일까지 7 수요일 × 10 = 70
    const n = nowcastAt(low, '2026-10-06');
    expect(low[low.length - 1].normalStock).toBe(60);
    expect(n.status).toBe('estimated');
    expect(n.estimatedStock).toBe(0);
    expect(n.low).toBe(0);
  });

  it('reads intermittent items (occasional big shipments) over four weeks, with a Croston average and bulk days set aside', () => {
    // 평일 5일 중 1일꼴로 50개씩 나가는 품목 — 며칠 단위로는 타이밍을 맞힐 수 없지만 4주 누적은 꽤 맞는다.
    const intermittent = history((d) => (Number(d.slice(8, 10)) % 5 === 0 ? 50 : 0), '2026-06-01', '2026-09-25', 20000);
    const series = demandDaySeries(intermittent);
    expect(demandPattern(series)).toBe('intermittent');
    const rel = forecastReliability({ observations: intermittent, horizonDays: 0 })!;
    expect(rel.pattern).toBe('intermittent');
    expect(rel.horizon).toBe(20);
    expect(rel.reason).toBeNull();
    // 평소 10개씩 나가다 하루 300개(대량 주문)가 끼면 그날은 평가·학습에서 뺀다.
    const days = Array.from({ length: 30 }, (_, i) => ({ date: shiftDate('2026-08-03', i), weekday: 1, value: i === 12 ? 300 : 10 }));
    const masked = maskBulkDays(days);
    expect(masked.bulkDays).toBe(1);
    expect(masked.series[12].value).toBeNull();
  });
});
