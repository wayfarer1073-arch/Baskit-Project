import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildGuideRows, buildTemplateSheet } from './templates';
import { alignColumnsToData, LAYOUT_FIELDS, suggestColumns } from './layout';
import { isExampleRow } from './example-rows';
import { parseInventoryWorkbook } from './parser';
import { parseSalesAoa } from './sales-parser';
import { HEADER_ALIASES, REQUIRED_FIELDS } from './types';
import { EXPIRATION_HEADER_ALIASES, EXPIRATION_REQUIRED_FIELDS } from './expiration-types';
import { PACKAGING_HEADER_ALIASES, PACKAGING_REQUIRED_FIELDS } from './packaging-types';
import { normalizeHeaderCell } from './aoa-reader';

/** 샘플 양식의 헤더가 실제 파서의 필수 컬럼을 전부 커버하는지 검증한다 — 파서 쪽 헤더 별칭이
 * 바뀌었는데 샘플 파일을 안 고치면 이 테스트가 잡아낸다. */
function assertCoversRequiredFields(headers: string[], headerAliases: Record<string, string[]>, requiredFields: string[]) {
  const normalizedHeaders = headers.map(normalizeHeaderCell);
  for (const field of requiredFields) {
    const aliases = headerAliases[field].map(normalizeHeaderCell);
    expect(aliases.some((a) => normalizedHeaders.includes(a))).toBe(true);
  }
}

describe('buildTemplateSheet', () => {
  it('inventory 템플릿이 파서의 필수 헤더(상품코드/상품명/정상재고)를 포함한다', () => {
    const sheet = buildTemplateSheet('inventory');
    assertCoversRequiredFields(sheet.headers, HEADER_ALIASES, REQUIRED_FIELDS);
    expect(sheet.rows.length).toBeGreaterThan(0);
    for (const row of sheet.rows) expect(row.length).toBe(sheet.headers.length);
  });

  it('expiration 템플릿이 파서의 필수 헤더(상품코드/소비기한)를 포함한다', () => {
    const sheet = buildTemplateSheet('expiration');
    assertCoversRequiredFields(sheet.headers, EXPIRATION_HEADER_ALIASES, EXPIRATION_REQUIRED_FIELDS);
    for (const row of sheet.rows) expect(row.length).toBe(sheet.headers.length);
  });

  it('packaging 템플릿이 파서의 필수 헤더(상품코드)를 포함한다', () => {
    const sheet = buildTemplateSheet('packaging');
    assertCoversRequiredFields(sheet.headers, PACKAGING_HEADER_ALIASES, PACKAGING_REQUIRED_FIELDS);
    for (const row of sheet.rows) expect(row.length).toBe(sheet.headers.length);
  });
});

describe('샘플 양식의 예시 행과 열 자동 선택', () => {
  const toBuffer = (aoa: (string | number)[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '업로드양식');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };

  it('재고 양식은 양식 설정에서 고를 수 있는 열을 모두 담고, 헤더 아래 두 줄이 작성 방법·예시 행이다', () => {
    const sheet = buildTemplateSheet('inventory');
    expect(sheet.headers).toHaveLength(LAYOUT_FIELDS.length);
    const { columns } = suggestColumns(sheet.headers, []);
    for (const field of LAYOUT_FIELDS) expect(columns[field]).toBeTruthy();
    expect(sheet.rows).toHaveLength(2);
    for (const row of sheet.rows) expect(isExampleRow(row.map(String))).toBe(true);
    expect(buildGuideRows(sheet).length).toBeGreaterThan(LAYOUT_FIELDS.length);
  });

  it('예시 행을 지우지 않고 올려도 건너뛰고, 값이 적힌 열만 읽는다', () => {
    const sheet = buildTemplateSheet('inventory');
    const real = sheet.headers.map((h) => (h === '상품코드' ? 'P-1' : h === '상품명' ? '진짜 상품' : h === '정상재고' ? 7 : h === '소비기한' ? '2027.01.15' : ''));
    const result = parseInventoryWorkbook(toBuffer([sheet.headers, ...sheet.rows, real]));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ productCode: 'P-1', normalStock: 7, expirationDates: ['2027-01-15'] });
    expect(result.issues.some((i) => i.code === 'EXAMPLE_ROWS_SKIPPED')).toBe(true);
    expect(Object.keys(result.layout!.columns).sort()).toEqual(['expirationDate', 'normalStock', 'productCode', 'productName']);
  });

  it('사용자가 해제한 열(null)은 값이 있어도 다시 켜지 않고, 값이 없는 열은 끈다', () => {
    const headers = ['상품코드', '상품명', '정상재고', '원가', '상품바코드', 'EA/BOX'];
    const rows = [['A', '사과', '3', '100', '880', '']];
    const { columns, emptyColumns } = alignColumnsToData(headers, rows, {
      productCode: '상품코드',
      productName: '상품명',
      normalStock: '정상재고',
      unitCost: null,
      eaPerBox: 'EA/BOX',
    });
    expect(columns.unitCost).toBeNull();
    expect(columns.barcode).toBe('상품바코드');
    expect(columns.eaPerBox).toBeUndefined();
    expect(emptyColumns).toEqual({ eaPerBox: 'EA/BOX' });
  });

  it('매출 양식의 예시 행은 건너뛴 줄로 세지 않는다', () => {
    const sheet = buildTemplateSheet('sales');
    const { rows, skipped } = parseSalesAoa([sheet.headers, ...sheet.rows.map((r) => r.map(String)), ['2026-09-02', '5000', '']], '2026-09-30');
    expect(rows).toEqual([{ date: '2026-09-02', amount: 5000 }]);
    expect(skipped).toBe(0);
  });
});
