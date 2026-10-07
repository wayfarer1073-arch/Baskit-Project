import { describe, expect, it } from 'vitest';
import { matchesSoldOutFilter, soldOutDays } from '@/lib/inventory-filters';

const soldOut = (date: string | null) => ({ isSoldOut: true, soldOutDetectedDate: date });
const regular = { isSoldOut: false, soldOutDetectedDate: null };

describe('품절 필터', () => {
  it('품절 일수는 인식일 당일 0일부터 센다', () => {
    expect(soldOutDays('2026-10-01', '2026-10-01')).toBe(0);
    expect(soldOutDays('2026-09-23', '2026-10-07')).toBe(14);
    expect(soldOutDays(null, '2026-10-07')).toBe(0);
  });

  it('체크를 끄면 품절 품목만 빠지고 평소 품목은 그대로', () => {
    const off = { showSoldOut: false, hideAfterDays: 0 } as const;
    expect(matchesSoldOutFilter(soldOut('2026-10-06'), off, '2026-10-07')).toBe(false);
    expect(matchesSoldOutFilter(regular, off, '2026-10-07')).toBe(true);
  });

  it('n일 이상 품절된 품목만 숨긴다', () => {
    const f = { showSoldOut: true, hideAfterDays: 14 } as const;
    expect(matchesSoldOutFilter(soldOut('2026-09-24'), f, '2026-10-07')).toBe(true); // 13일
    expect(matchesSoldOutFilter(soldOut('2026-09-23'), f, '2026-10-07')).toBe(false); // 14일
    expect(matchesSoldOutFilter(soldOut('2026-08-01'), { showSoldOut: true, hideAfterDays: 0 }, '2026-10-07')).toBe(true);
  });
});
