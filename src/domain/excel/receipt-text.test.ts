import { describe, expect, it } from 'vitest';
import { parseReceiptText, receiptNumber, receiptToAoa, RECEIPT_LAYOUT } from './receipt-text';
import { parseMenuSales } from './menu-sales';

/** OKPOS 류 마감 정산서 — 상품별 매출 말고도 결제수단·시간대·분류 소계가 함께 찍힌다. */
const closing = `[마감 정산서]
카페 라임 강남점
사업자번호: 123-45-67890 대표: 홍길동
영업일자 2026.10.03  마감 22:05:11
------------------------------------
총매출액                  302,800
할인                       -3,000
순매출액                  299,800
객수 54   객단가 5,551
------------------------------------
신용카드          48     270,300
현금               6      29,500
------------------------------------
[상품별 매출]
상품명          수량        금액
[커피]           65      302,500
A01 아메리카노    45      202,500
A02 카페라떼      20      100,000
쇼핑백             3          300
바닐라 라떼
                   2       11,000
취소               1       -4,500
------------------------------------
[시간대별 매출]
10시              12       54,000
11시~12시         20       90,000
합계              68      302,800`;

describe('closing report text', () => {
  it('reads OCR numbers', () => {
    expect(receiptNumber('4,5OO')).toBe(4500);
    expect(receiptNumber('5.000')).toBe(5000);
    expect(receiptNumber('-1')).toBe(-1);
    expect(receiptNumber('(2)')).toBe(-2);
    expect(receiptNumber('5,000_.')).toBe(5000);
    expect(receiptNumber('1]')).toBe(1);
    expect(receiptNumber('ㅣ')).toBe(1);
    expect(receiptNumber('_')).toBeNull();
    expect(receiptNumber('500ml')).toBeNull();
    expect(receiptNumber('ICE')).toBeNull();
  });

  it('reads only the product lines of a closing report and feeds the menu-sales parser', () => {
    const r = parseReceiptText(closing);
    expect(r.date).toBe('2026-10-03');
    expect(r.lines.map((l) => [l.code, l.name, l.quantity, l.amount])).toEqual([
      ['A01', '아메리카노', 45, 202500],
      ['A02', '카페라떼', 20, 100000],
      [null, '쇼핑백', 3, 300],
      [null, '바닐라 라떼', 2, 11000],
    ]);
    const parsed = parseMenuSales(receiptToAoa(r), RECEIPT_LAYOUT, r.date);
    expect(parsed.missing).toEqual([]);
    expect(parsed.rows.map((x) => [x.date, x.name, x.quantity])).toEqual([
      ['2026-10-03', '아메리카노', 45],
      ['2026-10-03', '카페라떼', 20],
      ['2026-10-03', '쇼핑백', 3],
      ['2026-10-03', '바닐라 라떼', 2],
    ]);
  });

  it('reads real OCR noise between the numbers and price columns when printed', () => {
    const r = parseReceiptText('2026/9/30\n아메리카노    4,500 45 _ 202,500\n카페라떼      5,000_. 2O _ 100,000\n바닐라라떼    5,500 ㅣ] . 5,500\n??? 12 34 56');
    expect(r.date).toBe('2026-09-30');
    expect(r.lines.map((l) => [l.name, l.quantity, l.amount])).toEqual([
      ['아메리카노', 45, 202500],
      ['카페라떼', 20, 100000],
      ['바닐라라떼', 1, 5500],
    ]);
    expect(r.skipped).toBe(1);
  });
});
