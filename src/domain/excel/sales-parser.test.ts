import { describe, expect, it } from 'vitest';
import { parseSalesAoa, parseSalesDate } from './sales-parser';

describe('parseSalesDate', () => {
  it('흔한 날짜 표기를 읽는다', () => {
    expect(parseSalesDate('2026-09-01')).toBe('2026-09-01');
    expect(parseSalesDate('2026/9/1')).toBe('2026-09-01');
    expect(parseSalesDate('2026.09.01')).toBe('2026-09-01');
    expect(parseSalesDate('20260901')).toBe('2026-09-01');
    expect(parseSalesDate('9/1/26')).toBe('2026-09-01');
    expect(parseSalesDate('2026년 9월 1일')).toBe('2026-09-01');
    expect(parseSalesDate('46266')).toBe('2026-09-01');
  });
  it('없는 날짜는 거른다', () => {
    expect(parseSalesDate('2026-02-30')).toBeNull();
    expect(parseSalesDate('어제')).toBeNull();
  });
});

describe('parseSalesAoa', () => {
  it('머리글 열을 찾아 읽고, 읽을 수 없거나 미래인 줄은 건너뛴다', () => {
    const aoa = [
      ['매장 매출'],
      ['비고', '날짜', '매출'],
      ['', '2026-09-01', '1,250,000'],
      ['', '2026-09-02', '₩980,000'],
      ['', '2026-09-03', '모름'],
      ['', '2026-10-01', '100'],
      ['', '2026-09-01', '1300000'],
    ];
    expect(parseSalesAoa(aoa, '2026-09-30')).toEqual({
      rows: [
        { date: '2026-09-01', amount: 1300000 },
        { date: '2026-09-02', amount: 980000 },
      ],
      skipped: 2,
    });
  });
  it('머리글이 없으면 앞의 두 열을 쓴다', () => {
    expect(parseSalesAoa([['2026-09-05', '500000']], '2026-09-30').rows).toEqual([{ date: '2026-09-05', amount: 500000 }]);
  });
});
