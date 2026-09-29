import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { autoLayout, parseInventoryWorkbook } from './parser';
import { detectHeaderRow, headerFingerprint, parseDateCell, readSheets, suggestColumns } from './layout';

function buildXlsxBuffer(aoa: (string | number)[][]): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseInventoryWorkbook - 최소 헤더 기반 업로드', () => {
  it('컬럼 순서와 불필요한 컬럼에 상관없이 필요한 다섯 필드만 읽는다', () => {
    const rows = [
      ['공급처', '정상재고', '상품명', '원가합', '메모', '상품코드', '원가'],
      ['거래처A', '10', '상품A', '9,500', '저장하지 않음', '00001', '1,000'],
    ];
    const result = parseInventoryWorkbook(buildXlsxBuffer(rows));

    expect(result.issues.filter((issue) => issue.level === 'ERROR')).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      productCode: '00001',
      productName: '상품A',
      unitCost: 1000,
      totalCost: 9500,
      normalStock: 10,
      availableStock: 10,
      extra: {},
    });
  });

  it('품목코드·품목명·매입단가·재고수량 같은 별칭도 인식한다', () => {
    const rows = [
      ['품목명', '재고수량', '품목코드', '매입단가'],
      ['상품B', '7', 'SKU-2', '1,250원'],
    ];
    const result = parseInventoryWorkbook(buildXlsxBuffer(rows));

    expect(result.issues.filter((issue) => issue.level === 'ERROR')).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ productCode: 'SKU-2', productName: '상품B', unitCost: 1250, totalCost: null, normalStock: 7 });
  });

  it('"가용재고" 헤더만 있으면 정상재고로 인식한다', () => {
    const rows = [
      ['상품코드', '상품명', '가용재고'],
      ['00003', '상품C', '42'],
    ];
    const result = parseInventoryWorkbook(buildXlsxBuffer(rows));

    expect(result.issues.filter((issue) => issue.level === 'ERROR')).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ productCode: '00003', productName: '상품C', normalStock: 42, availableStock: 42 });
  });

  it('"정상재고"와 "가용재고"가 함께 있으면 정상재고 값만 인식한다(가용재고 열은 무시)', () => {
    const rows = [
      ['상품코드', '상품명', '가용재고', '정상재고'],
      ['00004', '상품D', '999', '15'],
    ];
    const result = parseInventoryWorkbook(buildXlsxBuffer(rows));

    expect(result.issues.filter((issue) => issue.level === 'ERROR')).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ productCode: '00004', productName: '상품D', normalStock: 15, availableStock: 15 });
  });

  it('원가와 원가합 헤더가 모두 없어도 업로드하고 원가 누락을 표시한다', () => {
    const rows = [
      ['상품코드', '상품명', '정상재고'],
      ['A-1', '상품A', '5'],
    ];
    const result = parseInventoryWorkbook(buildXlsxBuffer(rows));

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].costMissing).toBe(true);
    expect(result.rows[0].unitCost).toBe(0);
    expect(result.rows[0].totalCost).toBeNull();
    expect(result.issues.some((issue) => issue.code === 'COST_MISSING' && issue.level === 'WARNING')).toBe(true);
  });

  it('필수 헤더가 없으면 저장하지 않는다', () => {
    const rows = [['상품명', '정상재고'], ['상품A', '100']];
    const result = parseInventoryWorkbook(buildXlsxBuffer(rows));
    expect(result.rows).toHaveLength(0);
    expect(result.issues.some((issue) => issue.code === 'MISSING_REQUIRED_COLUMN' && issue.column === 'productCode')).toBe(true);
  });

  it('상품코드·상품명 누락은 그 행만 제외하고, 상품코드 중복은 합산하며 모두 WARNING이다(파일 전체를 막지 않음, 회귀 테스트)', () => {
    const rows = [
      ['상품코드', '상품명', '정상재고'],
      ['', '상품A', '1'],
      ['A', '', '1'],
      ['B', '상품B', '1'],
      ['B', '상품B-2', '2'],
    ];
    const result = parseInventoryWorkbook(buildXlsxBuffer(rows));

    expect(result.rows).toHaveLength(1);
    expect(result.issues.some((issue) => issue.code === 'MISSING_PRODUCT_CODE' && issue.level === 'WARNING')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'MISSING_PRODUCT_NAME' && issue.level === 'WARNING')).toBe(true);
    // 같은 상품코드가 여러 행이면(로케이션·로트별 양식) 재고를 합산하고 경고로 알린다.
    expect(result.rows[0]).toMatchObject({ productCode: 'B', normalStock: 3 });
    expect(result.issues.some((issue) => issue.code === 'DUPLICATE_PRODUCT_CODE_MERGED' && issue.level === 'WARNING')).toBe(true);
    expect(result.issues.filter((issue) => issue.level === 'ERROR')).toHaveLength(0);
  });

  it('여러 행 중 한 행에만 문제가 있어도 나머지 정상 행은 전부 저장된다(핵심 회귀 테스트)', () => {
    const rows = [
      ['상품코드', '상품명', '정상재고', '원가'],
      ['00001', '아크바 실론티', '10', '1000'],
      ['', '상품코드누락', '10', '1000'],
      ['00002', '드럼스틱', '숫자아님', '1000'],
      ['00003', '나나콘', '10', '1000'],
    ];
    const result = parseInventoryWorkbook(buildXlsxBuffer(rows));

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.productCode).sort()).toEqual(['00001', '00003']);
    expect(result.issues.filter((issue) => issue.level === 'ERROR')).toHaveLength(0);
    expect(result.issues.filter((issue) => issue.level === 'WARNING')).toHaveLength(2);
  });

  it('정상재고는 정수여야 하고 숫자 범위를 검사한다', () => {
    const decimal = parseInventoryWorkbook(buildXlsxBuffer([['상품코드', '상품명', '정상재고'], ['A', '상품A', '1.5']]));
    const overflow = parseInventoryWorkbook(buildXlsxBuffer([['상품코드', '상품명', '정상재고'], ['A', '상품A', '99999999999']]));

    expect(decimal.rows).toHaveLength(0);
    expect(decimal.issues.some((issue) => issue.code === 'NUMBER_NOT_INTEGER')).toBe(true);
    expect(overflow.rows).toHaveLength(0);
    expect(overflow.issues.some((issue) => issue.code === 'NUMBER_OUT_OF_RANGE')).toBe(true);
  });

  it('헤더만 있고 데이터가 없으면 오류를 반환한다', () => {
    const result = parseInventoryWorkbook(buildXlsxBuffer([['상품코드', '상품명', '정상재고']]));
    expect(result.rows).toHaveLength(0);
    expect(result.issues.some((issue) => issue.code === 'NO_DATA_ROWS')).toBe(true);
  });
});

describe('parseInventoryWorkbook - HTML 기반 유사-xls', () => {
  it('최소 헤더를 가진 HTML table도 정상 파싱한다', () => {
    const html = `
      <html><body><table>
      <tr><td>상품코드</td><td>상품명</td><td>원가</td><td>정상재고</td></tr>
      <tr><td>00001</td><td>A&#40;special&#x29;</td><td>1,200</td><td>420</td></tr>
      </table></body></html>
    `;
    const result = parseInventoryWorkbook(Buffer.from(html, 'utf-8'));

    expect(result.issues.filter((issue) => issue.level === 'ERROR')).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ productCode: '00001', productName: 'A(special)', unitCost: 1200, normalStock: 420, availableStock: 420 });
  });
});

function buildMultiSheet(sheets: Record<string, (string | number)[][]>): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), name);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('양식(레이아웃) 자동 인식과 템플릿', () => {
  it('찾은 헤더가 3행 아래에 있어도, 영어 헤더여도 필드를 추천한다', () => {
    const aoa = [['Stock report'], ['Warehouse: Seoul'], [], ['Item Code', 'Description', 'Qty On Hand', 'Unit Cost', 'As of'], ['A1', 'Apple', '5', '100', '2026-09-28']];
    const sheets = readSheets(buildMultiSheet({ Report: aoa }));
    const header = detectHeaderRow(sheets[0].aoa);
    expect(sheets[0].aoa[header][0]).toBe('Item Code');
    const suggestion = suggestColumns(sheets[0].aoa[header], sheets[0].aoa.slice(header + 1));
    expect(suggestion.columns).toMatchObject({ productCode: 'Item Code', productName: 'Description', normalStock: 'Qty On Hand', unitCost: 'Unit Cost', snapshotDate: 'As of' });
    const result = parseInventoryWorkbook(buildMultiSheet({ Report: aoa }));
    expect(result.rows).toEqual([expect.objectContaining({ productCode: 'A1', normalStock: 5, unitCost: 100 })]);
    expect(result.fileDates).toEqual(['2026-09-28']);
  });

  it('사용자가 고른 시트·헤더 행·열 이름으로 읽고, 열 순서가 바뀌어도 이름으로 찾는다', () => {
    const buffer = buildMultiSheet({
      Summary: [['요약'], ['합계', '100']],
      Detail: [['로케이션', '재고', '품번', '품명'], ['A-01', '7', 'X1', '엑스'], ['A-02', '3', 'X1', '엑스'], ['B-01', '4', 'Y1', '와이']],
    });
    const layout = { sheetName: 'Detail', headerRowIndex: 0, columns: { productCode: '품번', productName: '품명', normalStock: '재고' }, duplicateMode: 'sum' as const };
    const result = parseInventoryWorkbook(buffer, layout);
    expect(result.rows.map((r) => [r.productCode, r.normalStock])).toEqual([['X1', 10], ['Y1', 4]]);
    const skipped = parseInventoryWorkbook(buffer, { ...layout, duplicateMode: 'skip' });
    expect(skipped.rows.map((r) => [r.productCode, r.normalStock])).toEqual([['X1', 7], ['Y1', 4]]);
  });

  it('템플릿이 기억한 열이 파일에 없으면 필수 열은 오류, 선택 열은 경고로 알린다', () => {
    const buffer = buildXlsxBuffer([['상품코드', '상품명', '정상재고'], ['A', '가', '1']]);
    const missingOptional = parseInventoryWorkbook(buffer, { sheetName: null, headerRowIndex: 0, columns: { productCode: '상품코드', productName: '상품명', normalStock: '정상재고', unitCost: '매입가' }, duplicateMode: 'sum' });
    expect(missingOptional.rows).toHaveLength(1);
    expect(missingOptional.issues.find((i) => i.code === 'TEMPLATE_COLUMN_NOT_FOUND')?.level).toBe('WARNING');
    const missingRequired = parseInventoryWorkbook(buffer, { sheetName: null, headerRowIndex: 0, columns: { productCode: '품번', productName: '상품명', normalStock: '정상재고' }, duplicateMode: 'sum' });
    expect(missingRequired.issues.some((i) => i.level === 'ERROR')).toBe(true);
    expect(parseInventoryWorkbook(buffer, { sheetName: 'Nope', headerRowIndex: 0, columns: {}, duplicateMode: 'sum' }).issues[0].code).toBe('SHEET_NOT_FOUND');
  });

  it('헤더 지문은 열 순서·공백·대소문자와 무관하다', () => {
    expect(headerFingerprint(['상품 코드', 'Qty', '상품명'])).toBe(headerFingerprint(['상품명', 'qty', '상품코드']));
    expect(headerFingerprint(['상품코드', '재고'])).not.toBe(headerFingerprint(['상품코드', '재고', '원가']));
  });

  it('여러 형식의 날짜를 읽고 없는 날짜는 거른다', () => {
    expect(parseDateCell('2026.09.28')).toBe('2026-09-28');
    expect(parseDateCell('20260928')).toBe('2026-09-28');
    expect(parseDateCell('9/28/26')).toBe('2026-09-28');
    expect(parseDateCell('2026년 9월 28일')).toBe('2026-09-28');
    expect(parseDateCell('2026-02-30')).toBeNull();
    expect(parseDateCell('재고')).toBeNull();
  });

  it('자동 레이아웃은 첫 시트와 합산 모드를 기본으로 쓴다', () => {
    const sheets = readSheets(buildXlsxBuffer([['상품코드', '상품명', '정상재고']]));
    expect(autoLayout(sheets)).toMatchObject({ sheetName: 'Sheet1', headerRowIndex: 0, duplicateMode: 'sum' });
  });
});
