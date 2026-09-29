import { NUMERIC_FIELDS, type CanonicalField, type ParseResult, type ParsedInventoryRow, type ValidationIssue } from './types';
import { normalizeString } from './aoa-reader';
import { detectHeaderRow, parseDateCell, readSheets, REQUIRED_LAYOUT_FIELDS, resolveColumns, suggestColumns, type ImportLayout, type LayoutField, type SheetData } from './layout';

/** 콤마 천단위 구분자, 공백, 통화기호를 제거하고 숫자로 변환한다. 빈 값/파싱 실패는 null. */
function normalizeNumber(value: string): number | null {
  const trimmed = normalizeString(value);
  if (trimmed === '') return null;
  const cleaned = trimmed.replace(/,/g, '').replace(/원$/, '').trim();
  if (cleaned === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** DB에 정수(Int) 컬럼으로 저장되는 필드. 소수는 허용하지 않는다. */
const INTEGER_FIELDS: CanonicalField[] = ['normalStock'];

// PostgreSQL Int(4바이트)의 표현 범위. 초과 값은 DB insert 시점에 에러가 나므로 파싱 단계에서 먼저 막는다.
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

// unitCost 등 Decimal(14,2) 컬럼의 표현 범위 (정수부 최대 12자리).
const DECIMAL_14_2_MAX = 10 ** 12 - 0.01;
const DECIMAL_14_2_MIN = -DECIMAL_14_2_MAX;

// 원가합은 단위원가 × PostgreSQL Int 재고수량까지 담을 수 있도록 Decimal(24,2)를 사용한다.
const DECIMAL_24_2_MAX = 10 ** 22 - 0.01;
const DECIMAL_24_2_MIN = -DECIMAL_24_2_MAX;

const MAX_DATA_ROWS = 50_000; // 실제 창고 품목 수보다 훨씬 넉넉한 상한 (동기 파싱 리소스 보호용)

const FIELD_LABEL: Record<LayoutField, string> = {
  productCode: '상품코드',
  productName: '상품명',
  normalStock: '재고수량',
  unitCost: '단위원가',
  totalCost: '원가합계',
  snapshotDate: '기준일',
};

/** 레이아웃을 주지 않으면 첫 시트에서 헤더 행과 열을 자동으로 찾는다(가장 흔한 양식은 확인 없이 바로 들어간다). */
export function autoLayout(sheets: SheetData[], sheetName?: string | null): ImportLayout {
  const sheet = sheets.find((s) => s.name === sheetName) ?? sheets[0];
  const headerRowIndex = sheet ? detectHeaderRow(sheet.aoa) : 0;
  const headers = sheet?.aoa[headerRowIndex] ?? [];
  const { columns } = suggestColumns(headers, sheet?.aoa.slice(headerRowIndex + 1, headerRowIndex + 21) ?? []);
  return { sheetName: sheet?.name ?? null, headerRowIndex, columns, duplicateMode: 'sum' };
}

/**
 * 재고 파일을 레이아웃대로 읽는다. 문제가 있는 행만 건너뛰고(경고) 나머지 정상 행은 전부 살린다 —
 * 한 셀의 오타 때문에 수백 개 상품이 통째로 사라지지 않도록.
 */
export function parseInventoryWorkbook(buffer: Buffer, layout?: ImportLayout): ParseResult {
  const sheets = readSheets(buffer);
  if (sheets.length === 0) {
    return { rows: [], headerMap: {}, issues: [{ level: 'ERROR', code: 'EMPTY_FILE', message: '파일에서 표 데이터를 찾을 수 없습니다.' }], fileDates: [] };
  }
  return parseSheets(sheets, layout ?? autoLayout(sheets));
}

export function parseSheets(sheets: SheetData[], layout: ImportLayout): ParseResult {
  const issues: ValidationIssue[] = [];
  const sheet = (layout.sheetName ? sheets.find((s) => s.name === layout.sheetName) : sheets[0]) ?? null;
  if (!sheet) {
    issues.push({ level: 'ERROR', code: 'SHEET_NOT_FOUND', message: `양식에 지정된 시트 '${layout.sheetName}'를 파일에서 찾을 수 없습니다.` });
    return { rows: [], headerMap: {}, issues, fileDates: [], layout };
  }
  const aoa = sheet.aoa;
  const headerRow = aoa[layout.headerRowIndex] ?? [];
  const { indexes, missing } = resolveColumns(headerRow, layout.columns);
  const headerMap: ParseResult['headerMap'] = {};
  for (const [field, idx] of Object.entries(indexes)) if (field !== 'snapshotDate') headerMap[field as CanonicalField] = headerRow[idx as number];

  for (const field of missing) {
    issues.push({
      level: REQUIRED_LAYOUT_FIELDS.includes(field) ? 'ERROR' : 'WARNING',
      code: 'TEMPLATE_COLUMN_NOT_FOUND',
      message: `'${FIELD_LABEL[field]}'로 지정한 열 '${layout.columns[field]}'을(를) 파일에서 찾을 수 없습니다.`,
      column: field,
    });
  }
  for (const field of REQUIRED_LAYOUT_FIELDS) {
    if (indexes[field] === undefined && !missing.includes(field)) {
      issues.push({ level: 'ERROR', code: 'MISSING_REQUIRED_COLUMN', message: `필수 컬럼을 찾을 수 없습니다: ${FIELD_LABEL[field]}`, column: field });
    }
  }
  if (issues.some((i) => i.level === 'ERROR')) return { rows: [], headerMap, issues, fileDates: [], layout };

  const dataRows = aoa.slice(layout.headerRowIndex + 1).filter((r) => r.some((c) => normalizeString(c) !== ''));
  if (dataRows.length === 0) {
    issues.push({ level: 'ERROR', code: 'NO_DATA_ROWS', message: '헤더는 있지만 상품 데이터가 한 건도 없습니다.' });
    return { rows: [], headerMap, issues, fileDates: [], layout };
  }
  if (dataRows.length > MAX_DATA_ROWS) {
    issues.push({
      level: 'ERROR',
      code: 'TOO_MANY_ROWS',
      message: `상품 행이 ${dataRows.length.toLocaleString()}건으로 처리 가능한 최대치(${MAX_DATA_ROWS.toLocaleString()}건)를 초과합니다.`,
    });
    return { rows: [], headerMap, issues, fileDates: [], layout };
  }

  const rows: ParsedInventoryRow[] = [];
  const rowByCode = new Map<string, ParsedInventoryRow>();
  const mergedCodes: string[] = [];
  const fileDates = new Set<string>();

  dataRows.forEach((rawRow, i) => {
    const rowNumber = i + 1;
    const get = (field: LayoutField): string => {
      const idx = indexes[field];
      return idx === undefined ? '' : normalizeString(rawRow[idx]);
    };

    if (indexes.snapshotDate !== undefined) {
      const date = parseDateCell(get('snapshotDate'));
      if (date) fileDates.add(date);
    }

    const productCode = get('productCode');
    if (productCode === '') {
      issues.push({ level: 'WARNING', code: 'MISSING_PRODUCT_CODE', message: `${rowNumber}행: 상품코드가 비어 있어 이 행은 건너뜁니다.`, rowNumber, column: 'productCode' });
      return;
    }
    const existing = rowByCode.get(productCode);
    if (existing && layout.duplicateMode === 'skip') {
      issues.push({
        level: 'WARNING',
        code: 'DUPLICATE_PRODUCT_CODE',
        message: `${rowNumber}행: 상품코드 '${productCode}'가 ${existing.rowNumber}행과 중복되어 이 행은 건너뜁니다.`,
        rowNumber,
        column: 'productCode',
      });
      return;
    }

    const productName = get('productName');
    if (productName === '' && !existing) {
      issues.push({ level: 'WARNING', code: 'MISSING_PRODUCT_NAME', message: `${rowNumber}행: 상품명이 비어 있어 이 행은 건너뜁니다.`, rowNumber, column: 'productName' });
      return;
    }

    const numericValues: Partial<Record<CanonicalField, number>> = {};
    let hasParseFailure = false;
    for (const field of NUMERIC_FIELDS) {
      const raw = get(field);
      if (raw === '') continue;
      const parsed = normalizeNumber(raw);
      if (parsed === null) {
        issues.push({
          level: 'WARNING',
          code: 'NUMBER_PARSE_FAILED',
          message: `${rowNumber}행: '${FIELD_LABEL[field]}' 값 '${raw}'을(를) 숫자로 해석할 수 없어 이 행은 건너뜁니다.`,
          rowNumber,
          column: field,
        });
        hasParseFailure = true;
        continue;
      }
      if (INTEGER_FIELDS.includes(field) && !Number.isInteger(parsed)) {
        issues.push({
          level: 'WARNING',
          code: 'NUMBER_NOT_INTEGER',
          message: `${rowNumber}행: '${FIELD_LABEL[field]}' 값 '${raw}'은(는) 소수가 아닌 정수여야 해서 이 행은 건너뜁니다.`,
          rowNumber,
          column: field,
        });
        hasParseFailure = true;
        continue;
      }
      const [rangeMin, rangeMax] = INTEGER_FIELDS.includes(field)
        ? [INT32_MIN, INT32_MAX]
        : field === 'totalCost'
          ? [DECIMAL_24_2_MIN, DECIMAL_24_2_MAX]
          : [DECIMAL_14_2_MIN, DECIMAL_14_2_MAX];
      if (parsed < rangeMin || parsed > rangeMax) {
        issues.push({
          level: 'WARNING',
          code: 'NUMBER_OUT_OF_RANGE',
          message: `${rowNumber}행: '${FIELD_LABEL[field]}' 값 '${raw}'이(가) 처리 가능한 범위를 벗어나 이 행은 건너뜁니다.`,
          rowNumber,
          column: field,
        });
        hasParseFailure = true;
        continue;
      }
      numericValues[field] = parsed;
    }
    if (hasParseFailure) return;

    const normalStock = numericValues.normalStock ?? 0;
    const costMissing = get('unitCost') === '';

    if (existing) {
      // 로케이션·로트별로 나뉜 행 — 재고와 원가합은 더하고, 단가는 먼저 적힌 값을 쓴다.
      const merged = existing.normalStock + normalStock;
      if (merged > INT32_MAX) {
        issues.push({
          level: 'WARNING',
          code: 'NUMBER_OUT_OF_RANGE',
          message: `${rowNumber}행: 상품코드 '${productCode}'의 합산 재고가 처리 가능한 범위를 벗어나 이 행은 더하지 않습니다.`,
          rowNumber,
        });
        return;
      }
      existing.normalStock = merged;
      existing.availableStock = merged;
      existing.totalCost = existing.totalCost !== null && numericValues.totalCost !== undefined ? existing.totalCost + numericValues.totalCost : null;
      if (existing.costMissing && !costMissing) {
        existing.unitCost = numericValues.unitCost ?? 0;
        existing.costMissing = false;
      }
      if (!mergedCodes.includes(productCode)) mergedCodes.push(productCode);
      return;
    }

    if (normalStock < 0) {
      issues.push({ level: 'WARNING', code: 'NEGATIVE_STOCK', message: `${rowNumber}행: 정상재고가 음수입니다 (${normalStock}).`, rowNumber });
    }

    const row: ParsedInventoryRow = {
      rowNumber,
      productCode,
      productName,
      option: null,
      barcode: null,
      unitCost: numericValues.unitCost ?? 0,
      totalCost: numericValues.totalCost ?? null,
      normalStock,
      availableStock: normalStock,
      incomingStock: 0,
      defectiveStock: 0,
      warningQty: 0,
      dangerQty: 0,
      location: null,
      category: null,
      extra: {},
      costMissing,
    };
    rows.push(row);
    rowByCode.set(productCode, row);
  });

  for (const row of rows) {
    if (row.costMissing) {
      issues.push({
        level: 'WARNING',
        code: 'COST_MISSING',
        message: `${row.rowNumber}행: 원가가 비어 있어 동일 SKU의 최근 원가를 사용합니다. 이전 원가도 없으면 0원으로 처리됩니다.`,
        rowNumber: row.rowNumber,
        column: 'unitCost',
      });
    }
  }
  if (mergedCodes.length > 0) {
    const sample = mergedCodes.slice(0, 5).join(', ');
    issues.push({
      level: 'WARNING',
      code: 'DUPLICATE_PRODUCT_CODE_MERGED',
      message: `상품코드 ${mergedCodes.length}개가 여러 행(로케이션·로트별)으로 나뉘어 있어 재고를 합산했습니다: ${sample}${mergedCodes.length > 5 ? ' 외' : ''}`,
    });
  }

  return { rows, headerMap, issues, fileDates: [...fileDates].sort(), layout };
}
