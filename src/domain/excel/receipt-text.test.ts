import { describe, expect, it } from 'vitest';
import { parseReceiptText, receiptNumber, receiptToAoa } from './receipt-text';
import { parseMenuSales } from './menu-sales';
import { RECEIPT_LAYOUT } from './receipt-text';

const customer = `카페 라임 강남점
사업자번호: 123-45-67890 대표: 홍길동
TEL: 02-123-4567
[영수증] 2026-10-04 14:23:11 POS:01-0023
------------------------------------------
상품명              단가   수량      금액
------------------------------------------
아메리카노(ICE)      4,5OO    2     9,000
카페라떼             5.000    1     5,000
바닐라 라떼
                     5,500    1     5,500
쿠키 할인           -500
------------------------------------------
합계 금액                          19,000
부  가  세                          1,727
받을금액                           19,000
신용카드                           19,000
승인번호: 12345678`;

const daily = `상품별 매출 현황
영업일자 2026.10.03
상품명\t수량\t금액
A01 아메리카노\t45\t202,500
A02 카페라떼\t20\t100,000
쇼핑백\t3\t300
합계\t68\t302,800`;

describe('receipt text', () => {
  it('reads OCR numbers', () => {
    expect(receiptNumber('4,5OO')).toBe(4500);
    expect(receiptNumber('5.000')).toBe(5000);
    expect(receiptNumber('-1')).toBe(-1);
    expect(receiptNumber('(2)')).toBe(-2);
    expect(receiptNumber('500ml')).toBeNull();
    expect(receiptNumber('ICE')).toBeNull();
    expect(receiptNumber('5,000_.')).toBe(5000);
    expect(receiptNumber('1]')).toBe(1);
    expect(receiptNumber('ㅣ')).toBe(1);
    expect(receiptNumber('_')).toBeNull();
  });

  it('reads a customer receipt: price × qty = amount, wrapped names, skips totals and payment lines', () => {
    const r = parseReceiptText(customer);
    expect(r.date).toBe('2026-10-04');
    expect(r.kind).toBe('single');
    expect(r.key).toBe('12345678 14:23:11');
    expect(r.lines).toEqual([
      { name: '아메리카노(ICE)', code: null, quantity: 2, amount: 9000 },
      { name: '카페라떼', code: null, quantity: 1, amount: 5000 },
      { name: '바닐라 라떼', code: null, quantity: 1, amount: 5500 },
    ]);
  });

  it('reads a daily product report with codes and feeds the menu-sales parser', () => {
    const r = parseReceiptText(daily);
    expect(r).toMatchObject({ date: '2026-10-03', kind: 'daily', key: null, skipped: 0 });
    expect(r.lines.map((l) => [l.code, l.name, l.quantity, l.amount])).toEqual([
      ['A01', '아메리카노', 45, 202500],
      ['A02', '카페라떼', 20, 100000],
      [null, '쇼핑백', 3, 300],
    ]);
    const parsed = parseMenuSales(receiptToAoa(r), RECEIPT_LAYOUT, r.date);
    expect(parsed.missing).toEqual([]);
    expect(parsed.rows.map((x) => [x.date, x.code, x.name, x.quantity])).toEqual([
      ['2026-10-03', 'A01', '아메리카노', 45],
      ['2026-10-03', 'A02', '카페라떼', 20],
      ['2026-10-03', null, '쇼핑백', 3],
    ]);
  });

  it('reads real OCR noise between the numbers (tesseract on a photo)', () => {
    const r = parseReceiptText('아메리카노    4,500 2 _ 9,000\n카페라떼      5,000_. ㅣ _ 5,000\n바닐라라떼    5,500 1] . 5,500\n부가세                 10035');
    expect(r.lines.map((l) => [l.name, l.quantity, l.amount])).toEqual([
      ['아메리카노', 2, 9000],
      ['카페라떼', 1, 5000],
      ['바닐라라떼', 1, 5500],
    ]);
  });

  it('handles price-then-quantity lines and ignores lines it cannot read', () => {
    const r = parseReceiptText('2026/9/30\n딸기 스무디 6,000 2\n??? 12 34 56\n크로플 1 4,000');
    expect(r.date).toBe('2026-09-30');
    expect(r.lines.map((l) => [l.name, l.quantity, l.amount])).toEqual([
      ['딸기 스무디', 2, 12000],
      ['크로플', 1, 4000],
    ]);
    expect(r.skipped).toBe(1);
  });
});
