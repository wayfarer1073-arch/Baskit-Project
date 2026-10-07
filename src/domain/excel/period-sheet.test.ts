import { describe, expect, it } from 'vitest';
import { cellQuantity, dateFromFileName, detectPeriodSheet, parseHeaderDate, parsePeriodSheet, resolveYears } from './period-sheet';
import { buildPeriodPlan } from './period-plan';

const stockAoa = [
  ['공급처', '상품코드', '상품명', '09-29', '09-30', '10-01', '10-02'],
  ['A상사', '001', '젤리 70g', '10', '8', '', '5'], // 10-01 빈칸 → 품절
  ['A상사', '002', '꿀 500g', '', '', '20', '18'], // 09-29·09-30 빈칸, 10-01 입고로 등록
  ['A상사', '003', '쿠키', '', '', '', ''], // 기간 내내 빈칸, 창고에 없음 → 올리지 않음
  ['A상사', '004', '캔디', '', '', '', ''], // 기간 내내 빈칸이지만 창고에 있던 SKU → 품절
  ['A상사', '005', '시럽', '', '', '', '3'], // 입고가 먼저(09-30)
];
const inboundAoa = [
  ['공급처', '상품코드', '상품명', '09-29', '09-30', '10-01', '10-02'],
  ['A상사', '002', '꿀 500g', '', '', '24', '0'],
  ['A상사', '005', '시럽', '', '6', '', ''],
  ['A상사', '999', '모르는 상품', '3', '', '', ''],
];

describe('period sheet', () => {
  it('reads date headers in common shapes', () => {
    expect(parseHeaderDate('07-01')).toEqual({ year: null, month: 7, day: 1 });
    expect(parseHeaderDate('7/1')).toEqual({ year: null, month: 7, day: 1 });
    expect(parseHeaderDate('7월 1일')).toEqual({ year: null, month: 7, day: 1 });
    expect(parseHeaderDate('07-01(수)')).toEqual({ year: null, month: 7, day: 1 });
    expect(parseHeaderDate('2026-07-01')).toEqual({ year: 2026, month: 7, day: 1 });
    expect(parseHeaderDate('2026.7.1')).toEqual({ year: 2026, month: 7, day: 1 });
    expect(parseHeaderDate('8/26/26')).toEqual({ year: 2026, month: 8, day: 26 });
    expect(parseHeaderDate('상품명')).toBeNull();
    expect(parseHeaderDate('13-01')).toBeNull();
  });

  it('gives years to month-day headers so the last column is not after the reference date', () => {
    const md = (m: number, d: number) => ({ year: null, month: m, day: d });
    expect(resolveYears([md(7, 1), md(10, 2)], '2026-10-07')).toEqual(['2026-07-01', '2026-10-02']);
    expect(resolveYears([md(12, 30), md(12, 31), md(1, 1), md(1, 2)], '2027-01-05')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(resolveYears([md(12, 30)], '2027-01-05')).toEqual(['2026-12-30']);
    expect(dateFromFileName('일자별재고현황_20261002165313_593117210.xlsx')).toBe('2026-10-02');
    expect(dateFromFileName('07011002_입고.xlsx')).toBeNull();
  });

  it('finds the header and columns, and reads quantities', () => {
    const layout = detectPeriodSheet([['일자별 재고현황'], ...stockAoa], '2026-10-07')!;
    expect(layout).toMatchObject({ headerRowIndex: 1, supplierCol: 0, codeCol: 1, nameCol: 2 });
    expect(layout.dateCols.map((d) => d.date)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(cellQuantity('1,234')).toBe(1234);
    expect(cellQuantity('')).toBeNull();
    expect(cellQuantity('-')).toBeNull();
    expect(Number.isNaN(cellQuantity('abc'))).toBe(true);
    const sheet = parsePeriodSheet([['일자별 재고현황'], ...stockAoa, ['', '합계', '', '10', '8', '20', '26']], layout);
    expect(sheet.rows).toHaveLength(5);
    expect([...sheet.rows[0].values]).toEqual([
      ['2026-09-29', 10],
      ['2026-09-30', 8],
      ['2026-10-02', 5],
    ]);
  });

  it('plans daily uploads: blanks after registration are sold out, before it unregistered; inbound starts registration', () => {
    const stock = parsePeriodSheet(stockAoa, detectPeriodSheet(stockAoa, '2026-10-07')!);
    const inbound = parsePeriodSheet(inboundAoa, detectPeriodSheet(inboundAoa, '2026-10-07')!);
    const plan = buildPeriodPlan({
      stock,
      inbound,
      knownFirstSeen: new Map([['004', '2026-09-01']]),
      existingDates: new Set(['2026-09-30']),
      blockedDates: new Set(),
      overwrite: false,
      today: '2026-10-07',
    });
    const at = (date: string) => plan.dates.find((d) => d.date === date)!;
    expect(plan.dates.map((d) => [d.date, d.status])).toEqual([
      ['2026-09-29', 'upload'],
      ['2026-09-30', 'existing'],
      ['2026-10-01', 'upload'],
      ['2026-10-02', 'upload'],
    ]);
    expect(at('2026-09-29').rows.map((r) => [r.code, r.stock])).toEqual([
      ['001', 10],
      ['004', 0],
    ]);
    expect(at('2026-10-01').rows.map((r) => [r.code, r.stock, r.inferredZero])).toEqual([
      ['001', 0, true],
      ['002', 20, false],
      ['004', 0, true],
      ['005', 0, true], // 09-30 입고로 등록됐지만 10-01 재고 칸이 비어 있음 → 품절
    ]);
    expect(plan).toMatchObject({ skuCount: 5, registeredCount: 4, emptyCount: 1, startedByInbound: 1, inboundUnknown: ['999'], inboundSkipped: 1 });
    expect(plan.inbound).toEqual([
      { code: '005', name: '시럽', date: '2026-09-30', quantity: 6 },
      { code: '002', name: '꿀 500g', date: '2026-10-01', quantity: 24 },
    ]);
    // 올리는 날(09-29·10-01·10-02)에 빈칸을 품절로 채운 칸: 09-29의 004, 10-01의 001·004·005, 10-02의 004
    expect(plan.inferredZeroCells).toBe(5);
  });

  it('can overwrite already uploaded dates and skips future or blocked dates', () => {
    const stock = parsePeriodSheet(stockAoa, detectPeriodSheet(stockAoa, '2026-10-07')!);
    const plan = buildPeriodPlan({
      stock,
      inbound: null,
      knownFirstSeen: new Map(),
      existingDates: new Set(['2026-09-30']),
      blockedDates: new Set(['2026-09-29']),
      overwrite: true,
      today: '2026-10-01',
    });
    expect(plan.dates.map((d) => d.status)).toEqual(['blocked', 'upload', 'upload', 'future']);
  });
});
