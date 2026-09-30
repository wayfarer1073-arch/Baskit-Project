import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseInventoryWorkbook } from './parser';
import { parseExpirationWorkbook } from './expiration-parser';
import { zipUncompressedSize } from './zip-guard';
import { MAX_UNCOMPRESSED_BYTES, MAX_UPLOAD_DATA_ROWS } from '@/lib/upload-limits';

function xlsx(rows: (string | number)[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const stockRows = (count: number, titleRows = 0) => [
  ...Array.from({ length: titleRows }, (_, i) => [`재고 현황 보고서 ${i + 1}`]),
  ['상품코드', '상품명', '정상재고'],
  ...Array.from({ length: count }, (_, i) => [`P${i}`, `상품 ${i}`, 10]),
];

describe('한 번에 올릴 수 있는 행 수', () => {
  it('헤더를 빼고 500행까지는 받는다(헤더 위 제목 줄도 세지 않는다)', () => {
    const result = parseInventoryWorkbook(xlsx(stockRows(MAX_UPLOAD_DATA_ROWS, 2)));
    expect(result.issues.filter((i) => i.level === 'ERROR')).toEqual([]);
    expect(result.rows).toHaveLength(MAX_UPLOAD_DATA_ROWS);
  });

  it('501행부터는 거절하고 행 수를 알려 준다', () => {
    const result = parseInventoryWorkbook(xlsx(stockRows(MAX_UPLOAD_DATA_ROWS + 1)));
    const error = result.issues.find((i) => i.code === 'TOO_MANY_ROWS');
    expect(error?.message).toContain('501행');
    expect(result.rows).toEqual([]);
  });

  it('아주 긴 파일은 앞부분만 읽고 거절한다', () => {
    const result = parseInventoryWorkbook(xlsx(stockRows(5000)));
    expect(result.issues.find((i) => i.code === 'TOO_MANY_ROWS')?.message).toMatch(/행 이상/);
  });

  it('소비기한 파일에도 같은 상한을 둔다', () => {
    const rows = [['상품코드', '소비기한'], ...Array.from({ length: MAX_UPLOAD_DATA_ROWS + 1 }, (_, i) => [`P${i}`, '2026-12-31'])];
    expect(parseExpirationWorkbook(xlsx(rows)).issues.some((i) => i.code === 'TOO_MANY_ROWS')).toBe(true);
  });
});

describe('압축 폭탄 막기', () => {
  it('일반 xlsx는 풀린 크기를 계산하고, zip이 아니면 null', () => {
    const size = zipUncompressedSize(xlsx(stockRows(10)));
    expect(size).toBeGreaterThan(0);
    expect(size!).toBeLessThan(MAX_UNCOMPRESSED_BYTES);
    expect(zipUncompressedSize(Buffer.from('상품코드,상품명\nP1,사과'))).toBeNull();
  });

  it('목록에 적힌 풀린 크기가 상한을 넘으면 파일을 열지 않고 거절한다', () => {
    const buffer = Buffer.from(xlsx(stockRows(10)));
    // central directory의 첫 항목 "원래 크기"를 200MB로 바꿔 압축 폭탄처럼 보이게 한다.
    const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const firstEntry = buffer.readUInt32LE(eocd + 16);
    buffer.writeUInt32LE(200 * 1024 * 1024, firstEntry + 24);
    expect(zipUncompressedSize(buffer)!).toBeGreaterThan(MAX_UNCOMPRESSED_BYTES);
    const result = parseInventoryWorkbook(buffer);
    expect(result.issues[0]).toMatchObject({ level: 'ERROR', code: 'FILE_REJECTED' });
  });
});
