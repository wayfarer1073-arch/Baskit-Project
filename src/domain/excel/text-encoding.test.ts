import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeTextTable, detectTextEncoding } from './text-encoding';
import { parseInventoryWorkbook } from './parser';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name));

describe('text table encoding', () => {
  it('detects EUC-KR and UTF-8 (with or without BOM)', () => {
    expect(detectTextEncoding(fixture('stock-euc-kr.csv'))).toBe('euc-kr');
    expect(detectTextEncoding(Buffer.from('상품코드,재고\n', 'utf-8'))).toBe('utf-8');
    expect(decodeTextTable(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('상품명\n')]))?.text).toBe('상품명\n');
  });

  it('reads an EUC-KR CSV without garbling Korean and keeps leading zeros and quoted commas', () => {
    const result = parseInventoryWorkbook(fixture('stock-euc-kr.csv'));
    expect(result.issues.filter((i) => i.level === 'ERROR')).toEqual([]);
    expect(result.rows.map((r) => [r.productCode, r.productName, r.normalStock])).toEqual([
      ['00123', '녹차 티백', 40],
      ['00456', '보리차, 대용량', 12],
    ]);
  });

  it('reads a UTF-16 tab-separated text export (Excel “Unicode text”)', () => {
    const result = parseInventoryWorkbook(fixture('stock-utf16.txt'));
    expect(result.rows.map((r) => [r.productCode, r.productName, r.normalStock])).toEqual([
      ['00123', '녹차 티백', 40],
      ['00456', '보리차 대용량', 12],
    ]);
  });

  it('leaves real workbooks to the spreadsheet reader', () => {
    expect(decodeTextTable(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBeNull();
  });
});
