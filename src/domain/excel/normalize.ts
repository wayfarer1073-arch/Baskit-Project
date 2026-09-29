import type { ParsedInventoryRow, ValidationIssue } from './types';
import { AUTO_CODE_DIGITS, AUTO_CODE_PREFIX, type StockUnit } from './layout-types';

/**
 * 파싱한 재고 행을 창고의 품목 기준으로 맞춘다 — 정규화의 두 번째·세 번째 층(품목 매핑, 단위 환산).
 * 순수 함수라 업로드 서비스와 테스트가 같은 규칙을 쓴다.
 */

/** 파일의 상품코드를 연결된 기존 SKU 코드로 바꾼다. 바꾼 뒤 같은 코드가 겹치면 재고를 합친다. */
export function applyCodeAliases(rows: ParsedInventoryRow[], aliasToCode: ReadonlyMap<string, string>): { rows: ParsedInventoryRow[]; aliased: number } {
  if (aliasToCode.size === 0) return { rows, aliased: 0 };
  const byCode = new Map<string, ParsedInventoryRow>();
  let aliased = 0;
  for (const row of rows) {
    const target = aliasToCode.get(row.productCode);
    const code = target ?? row.productCode;
    if (target) aliased++;
    const existing = byCode.get(code);
    if (!existing) {
      byCode.set(code, { ...row, productCode: code });
      continue;
    }
    existing.normalStock += row.normalStock;
    existing.availableStock = existing.normalStock;
    existing.totalCost = existing.totalCost !== null && row.totalCost !== null ? existing.totalCost + row.totalCost : null;
    if (existing.costMissing && !row.costMissing) {
      existing.unitCost = row.unitCost;
      existing.costMissing = false;
    }
    mergeRowExtras(existing, row);
  }
  return { rows: [...byCode.values()], aliased };
}

function mergeRowExtras(target: ParsedInventoryRow, row: ParsedInventoryRow) {
  if (!target.barcode && row.barcode) target.barcode = row.barcode;
  if (row.expirationDates?.length) target.expirationDates = [...new Set([...(target.expirationDates ?? []), ...row.expirationDates])].sort();
  if (target.eaPerBox == null && row.eaPerBox != null) target.eaPerBox = row.eaPerBox;
  if (target.eaPerPallet == null && row.eaPerPallet != null) target.eaPerPallet = row.eaPerPallet;
}

/**
 * 재고 0인 행에 양식 설정대로 상태를 붙인다 — 품절(기본) 또는 관리 제외. 박스 환산 뒤의 낱개 재고로 판단한다.
 * 저장되는 재고 행에도 extra.stockStatus로 남겨, 날짜를 바꿔 조회해도 그날 기준으로 판단할 수 있게 한다.
 */
export function markZeroStock(rows: ParsedInventoryRow[], zeroStockAsSoldOut: boolean | undefined): ParsedInventoryRow[] {
  const status = zeroStockAsSoldOut === false ? 'removed' : 'soldOut';
  return rows.map((row) => (row.normalStock === 0 ? { ...row, zeroStockStatus: status, extra: { ...row.extra, stockStatus: status } } : row));
}

const AUTO_CODE_PATTERN = new RegExp(`^${AUTO_CODE_PREFIX}(\\d{${AUTO_CODE_DIGITS},})$`);

/**
 * 상품코드 없이 올라온 행(상품명으로 구분)에 코드를 붙인다. 창고에 같은 이름의 품목이 있으면 그 코드를 쓰고,
 * 없으면 창고에서 쓰인 가장 큰 자동 코드 다음 번호(A0001, A0002 …)를 새로 붙인다 — 다음 업로드에도 같은 이름은 같은 코드가 된다.
 */
export function assignAutoCodes(
  rows: ParsedInventoryRow[],
  codeByName: ReadonlyMap<string, string>,
  knownCodes: ReadonlySet<string>,
): { rows: ParsedInventoryRow[]; assigned: number } {
  if (!rows.some((r) => r.autoCode)) return { rows, assigned: 0 };
  let next = 0;
  for (const code of knownCodes) {
    const match = code.match(AUTO_CODE_PATTERN);
    if (match) next = Math.max(next, Number(match[1]));
  }
  const taken = new Set(knownCodes);
  let assigned = 0;
  const out = rows.map((row) => {
    if (!row.autoCode) return row;
    let code = codeByName.get(row.productName);
    if (!code) {
      do code = `${AUTO_CODE_PREFIX}${String(++next).padStart(AUTO_CODE_DIGITS, '0')}`;
      while (taken.has(code));
      taken.add(code);
      assigned++;
    }
    const { autoCode: _autoCode, ...rest } = row;
    void _autoCode;
    return { ...rest, productCode: code };
  });
  return { rows: out, assigned };
}

export interface PackagingFactors {
  eaPerBox: number | null;
  eaPerPallet: number | null;
}

/**
 * 박스·팔레트 단위로 적힌 재고를 낱개(EA)로 바꾼다. 원가도 같은 단위 기준으로 보고 입수량으로 나눈다.
 * 입수량을 모르는 품목은 잘못된 수량이 저장되지 않도록 건너뛰고 알려준다.
 */
export function convertStockUnit(
  rows: ParsedInventoryRow[],
  unit: StockUnit,
  factors: ReadonlyMap<string, PackagingFactors>,
): { rows: ParsedInventoryRow[]; issues: ValidationIssue[] } {
  if (unit === 'EA') return { rows, issues: [] };
  const out: ParsedInventoryRow[] = [];
  const missing: string[] = [];
  for (const row of rows) {
    const f = factors.get(row.productCode);
    // 같은 파일에 입수량 열이 있으면 그 값을 먼저 쓴다.
    const factor = unit === 'BOX' ? (row.eaPerBox ?? f?.eaPerBox) : (row.eaPerPallet ?? f?.eaPerPallet);
    if (!factor || factor <= 0) {
      missing.push(row.productCode);
      continue;
    }
    const normalStock = Math.round(row.normalStock * factor);
    out.push({ ...row, normalStock, availableStock: normalStock, unitCost: row.costMissing ? row.unitCost : row.unitCost / factor });
  }
  const issues: ValidationIssue[] = missing.length
    ? [
        {
          level: 'WARNING',
          code: 'UNIT_FACTOR_MISSING',
          message: `입수량(EA/${unit === 'BOX' ? 'BOX' : 'PLT'}) 정보가 없어 ${missing.length}개 품목을 건너뛰었습니다: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' 외' : ''}. 설정 > 일일 재고 연동 > SKU 추가 정보에서 입수량을 올린 뒤 다시 업로드하세요.`,
        },
      ]
    : [];
  return { rows: out, issues };
}
