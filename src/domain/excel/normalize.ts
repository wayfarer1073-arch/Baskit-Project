import type { ParsedInventoryRow, ValidationIssue } from './types';
import type { StockUnit } from './layout-types';

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
  }
  return { rows: [...byCode.values()], aliased };
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
    const factor = unit === 'BOX' ? f?.eaPerBox : f?.eaPerPallet;
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
