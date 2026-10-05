import { describe, expect, it } from 'vitest';
import { detectMenuSalesLayout, findPeriod, parseMenuSales } from './menu-sales';

/** POS 상품별 매출 현황 모양 — 제목·조회기간·매장명 줄, 머리글, 합계 줄. */
const okposLike: string[][] = [
  ['상품별 매출 현황', '', '', '', '', '', ''],
  ['조회기간 : 2026-10-01 ~ 2026-10-01', '', '', '', '', '', ''],
  ['매장명 : 라임카페 본점', '', '', '', '', '', ''],
  ['', '', '', '', '', '', ''],
  ['대분류', '상품코드', '상품명', '판매수량', '총매출액', '할인액', '실매출액'],
  ['커피', '000101', '아메리카노', '42', '189,000', '0', '189,000'],
  ['커피', '000102', '카페라떼', '18', '90,000', '5,000', '85,000'],
  ['커피', '000101', '아메리카노', '(2)', '(9,000)', '0', '(9,000)'],
  ['베이커리', '000301', '크루아상', '7', '28,000', '0', '28,000'],
  ['', '', '합계', '65', '298,000', '5,000', '293,000'],
];

describe('menu sales parser', () => {
  it('finds the POS header below title rows and prefers net sales', () => {
    const layout = detectMenuSalesLayout(okposLike)!;
    expect(layout.headerRowIndex).toBe(4);
    expect(layout.columns).toEqual({ menuName: '상품명', quantity: '판매수량', menuCode: '상품코드', amount: '실매출액' });
    expect(findPeriod(okposLike, layout.headerRowIndex)).toEqual({ date: '2026-10-01', range: null });
  });

  it('merges returns into the same menu and skips the total row', () => {
    const layout = detectMenuSalesLayout(okposLike)!;
    const { rows, skipped, missing } = parseMenuSales(okposLike, layout, '2026-10-01');
    expect(missing).toEqual([]);
    expect(skipped).toBe(0);
    expect(rows).toEqual([
      { date: '2026-10-01', code: '000101', name: '아메리카노', quantity: 40, amount: 180000 },
      { date: '2026-10-01', code: '000102', name: '카페라떼', quantity: 18, amount: 85000 },
      { date: '2026-10-01', code: '000301', name: '크루아상', quantity: 7, amount: 28000 },
    ]);
  });

  it('reports a multi-day period instead of guessing a date', () => {
    const multi = [['조회기간 2026.09.28 ~ 2026.10.01'], ['상품명', '수량'], ['라떼', '3']];
    expect(findPeriod(multi, 1)).toEqual({ date: null, range: ['2026-09-28', '2026-10-01'] });
    expect(parseMenuSales(multi, detectMenuSalesLayout(multi)!, null).rows[0].date).toBeNull();
  });

  it('reads a custom layout chosen by the user, with a date column', () => {
    const custom = [
      ['판매일', '메뉴 이름', '팔린 개수', '비고'],
      ['2026/10/01', '아이스티', '5', ''],
      ['2026/10/02', '아이스티', '3', ''],
      ['2026/10/02', '레몬에이드', '모름', ''],
    ];
    expect(detectMenuSalesLayout(custom)).toBeNull();
    const result = parseMenuSales(custom, { headerRowIndex: 0, columns: { menuName: '메뉴 이름', quantity: '팔린 개수', date: '판매일' } }, null);
    expect(result.rows).toEqual([
      { date: '2026-10-01', code: null, name: '아이스티', quantity: 5, amount: null },
      { date: '2026-10-02', code: null, name: '아이스티', quantity: 3, amount: null },
    ]);
    expect(result.skipped).toBe(1);
  });

  it('tells which required columns are missing from a saved layout', () => {
    expect(parseMenuSales(okposLike, { headerRowIndex: 4, columns: { menuName: '메뉴명', quantity: '판매수량' } }, null).missing).toEqual(['menuName']);
  });
});
