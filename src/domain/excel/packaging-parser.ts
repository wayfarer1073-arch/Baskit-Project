import type { ValidationIssue } from './types';
import { MAX_UPLOAD_DATA_ROWS } from '@/lib/upload-limits';
import { bufferToAoa, normalizeString, findHeaderRowIndex, buildHeaderMap, SpreadsheetRejectedError, tooManyRowsMessage } from './aoa-reader';
import {
  PACKAGING_FIELDS,
  PACKAGING_HEADER_ALIASES,
  PACKAGING_REQUIRED_FIELDS,
  type PackagingField,
  type PackagingParseResult,
  type ParsedPackagingRow,
} from './packaging-types';


/** 빈 값은 null(갱신 안 함), 정수가 아니거나 음수면 파싱 실패로 null 처리하고 WARNING을 남긴다. */
function parseOptionalCount(value: string): { value: number | null; invalid: boolean } {
  const trimmed = normalizeString(value);
  if (trimmed === '') return { value: null, invalid: false };
  const n = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return { value: null, invalid: true };
  return { value: n, invalid: false };
}

/**
 * SKU 추가 정보(EA/BOX·EA/PLT·상품바코드) Excel을 파싱한다. 소비기한과 달리 비유동적인 참고
 * 정보라 행 단위 문제도 대부분 WARNING으로만 남기고 계속 진행한다 — 상품코드만 있으면 그 행은
 * 반영 대상이고, 나머지 컬럼은 비어 있거나 잘못돼도 그 필드만 건너뛴다(기존 값 유지).
 */
export function parsePackagingWorkbook(buffer: Buffer): PackagingParseResult {
  const issues: ValidationIssue[] = [];
  let aoa: string[][];
  try {
    aoa = bufferToAoa(buffer);
  } catch (e) {
    if (e instanceof SpreadsheetRejectedError) return { rows: [], issues: [{ level: 'ERROR', code: 'FILE_REJECTED', message: e.message }] };
    throw e;
  }

  if (aoa.length === 0) {
    issues.push({ level: 'ERROR', code: 'EMPTY_FILE', message: '파일에서 표 데이터를 찾을 수 없습니다.' });
    return { rows: [], issues };
  }

  const headerRowIdx = findHeaderRowIndex(aoa, PACKAGING_HEADER_ALIASES, 2);
  const headerRow = aoa[headerRowIdx];
  const headerMap = buildHeaderMap(headerRow, PACKAGING_HEADER_ALIASES, PACKAGING_FIELDS);

  const missingRequired = PACKAGING_REQUIRED_FIELDS.filter((f) => !headerMap[f]);
  if (missingRequired.length > 0) {
    for (const field of missingRequired) {
      issues.push({
        level: 'ERROR',
        code: 'MISSING_REQUIRED_COLUMN',
        message: `필수 컬럼을 찾을 수 없습니다: ${PACKAGING_HEADER_ALIASES[field][0]} (인식 가능한 이름: ${PACKAGING_HEADER_ALIASES[field].join(', ')})`,
        column: field,
      });
    }
    return { rows: [], issues };
  }

  const headerIndexByField = new Map<PackagingField, number>();
  for (const field of PACKAGING_FIELDS) {
    const headerName = headerMap[field];
    if (!headerName) continue;
    headerIndexByField.set(field, headerRow.indexOf(headerName));
  }

  const dataRows = aoa.slice(headerRowIdx + 1).filter((r) => r.some((c) => normalizeString(c) !== ''));
  if (dataRows.length === 0) {
    issues.push({ level: 'ERROR', code: 'NO_DATA_ROWS', message: '헤더는 있지만 데이터가 한 건도 없습니다.' });
    return { rows: [], issues };
  }
  if (dataRows.length > MAX_UPLOAD_DATA_ROWS) {
    issues.push({
      level: 'ERROR',
      code: 'TOO_MANY_ROWS',
      message: tooManyRowsMessage(dataRows.length),
    });
    return { rows: [], issues };
  }

  const rows: ParsedPackagingRow[] = [];

  dataRows.forEach((rawRow, i) => {
    const rowNumber = i + 1;
    const get = (field: PackagingField): string => {
      const idx = headerIndexByField.get(field);
      if (idx === undefined || idx === -1) return '';
      return normalizeString(rawRow[idx]);
    };

    const productCode = get('productCode');
    if (productCode === '') {
      issues.push({ level: 'WARNING', code: 'MISSING_PRODUCT_CODE', message: `${rowNumber}행: 상품코드가 비어 있어 건너뜁니다.`, rowNumber, column: 'productCode' });
      return;
    }

    const eaPerBoxResult = parseOptionalCount(get('eaPerBox'));
    if (eaPerBoxResult.invalid) {
      issues.push({ level: 'WARNING', code: 'INVALID_EA_PER_BOX', message: `${rowNumber}행: EA/BOX 값을 숫자로 해석할 수 없어 건너뜁니다.`, rowNumber, column: 'eaPerBox' });
    }
    const eaPerPalletResult = parseOptionalCount(get('eaPerPallet'));
    if (eaPerPalletResult.invalid) {
      issues.push({ level: 'WARNING', code: 'INVALID_EA_PER_PALLET', message: `${rowNumber}행: EA/PLT 값을 숫자로 해석할 수 없어 건너뜁니다.`, rowNumber, column: 'eaPerPallet' });
    }

    const productName = get('productName') || null;
    const barcode = get('barcode') || null;
    rows.push({ rowNumber, productCode, productName, eaPerBox: eaPerBoxResult.value, eaPerPallet: eaPerPalletResult.value, barcode });
  });

  return { rows, issues };
}
