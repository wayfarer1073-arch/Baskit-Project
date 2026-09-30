import { describe, expect, it } from 'vitest';
import { missingSalesDates } from './calendar-todo';

describe('missingSalesDates', () => {
  it('기록을 시작한 날부터 어제까지 매출이 없는 날을 센다', () => {
    const sales = new Set(['2026-09-25', '2026-09-27']);
    expect(missingSalesDates(sales, '2026-09-25', '2026-09-30')).toEqual(['2026-09-26', '2026-09-28', '2026-09-29']);
  });

  it('오래전에 시작했으면 최근 lookbackDays일만 본다', () => {
    expect(missingSalesDates(new Set(), '2025-01-01', '2026-09-30', 3)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29']);
  });

  it('한 번도 기록하지 않았으면 할 일이 없다', () => {
    expect(missingSalesDates(new Set(), null, '2026-09-30')).toEqual([]);
  });
});
