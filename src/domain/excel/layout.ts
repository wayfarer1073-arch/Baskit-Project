import * as XLSX from 'xlsx';
import { bufferToAoa, normalizeHeaderCell, normalizeString, readWorkbook } from './aoa-reader';
import { decodeTextTable } from './text-encoding';
import { HEADER_ALIASES } from './types';
import { LAYOUT_FIELDS, type ImportLayout, type LayoutField, type MatchConfidence } from './layout-types';

export * from './layout-types';

export interface SheetData {
  name: string;
  aoa: string[][];
}

/** 모든 시트를 문자열 표로 읽는다. HTML 표를 .xls로 저장한 파일은 시트 하나로 본다. */
export function readSheets(buffer: Buffer): SheetData[] {
  const head = buffer.subarray(0, 2048).toString('utf-8').toLowerCase();
  if (head.includes('<html') || head.includes('<table')) {
    const aoa = bufferToAoa(buffer);
    return aoa.length ? [{ name: 'Sheet1', aoa }] : [];
  }
  // CSV·TSV는 인코딩(UTF-8/EUC-KR 등)을 먼저 맞춰 읽는다. 값은 글자 그대로 두어 상품코드 앞자리 0 등이 사라지지 않게 한다.
  const textTable = decodeTextTable(buffer);
  const workbook = readWorkbook(buffer, textTable);
  return workbook.SheetNames.map((name) => ({
    name,
    aoa: XLSX.utils
      .sheet_to_json<string[]>(workbook.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false })
      .map((row) => row.map((cell) => (cell ?? '').toString())),
  })).filter((sheet) => sheet.aoa.length > 0);
}

/** 한국어 별칭 + 영어 별칭. 순서가 우선순위다(앞의 별칭과 정확히 일치하는 열을 먼저 고른다). */
export const LAYOUT_ALIASES: Record<LayoutField, string[]> = {
  productCode: [...HEADER_ALIASES.productCode, '관리코드', '자체상품코드', '상품번호', 'sku code', 'item code', 'product code', 'item no', 'item number', 'code'],
  productName: [...HEADER_ALIASES.productName, '품명', 'product name', 'item name', 'description', 'name'],
  normalStock: [...HEADER_ALIASES.normalStock, '실재고', '보유재고', '재고량', 'on hand', 'on-hand', 'qty on hand', 'available qty', 'stock', 'quantity', 'qty'],
  unitCost: [...HEADER_ALIASES.unitCost, 'unit cost', 'cost', 'unit price'],
  totalCost: [...HEADER_ALIASES.totalCost, 'total cost', 'stock value', 'inventory value', 'amount'],
  expirationDate: ['소비기한', '유통기한', '유효기한', '유효일자', '소비기한일자', 'expiry', 'expiry date', 'expiration date', 'exp date', 'best before'],
  barcode: ['상품바코드', '바코드', '바코드번호', 'barcode', 'ean', 'upc', 'gtin'],
  eaPerBox: ['EA/BOX', '박스입수', '박스 입수', '입수', '입수량', 'box qty', 'case pack', 'units per case', 'units per box'],
  eaPerPallet: ['EA/PLT', '팔레트입수', '파렛트입수', '팔레트 입수', 'PLT입수', 'units per pallet', 'pallet qty'],
  snapshotDate: ['기준일', '재고기준일', '기준일자', '재고일자', '조회일', '일자', '날짜', 'date', 'snapshot date', 'as of'],
};

const norm = (value: string) => normalizeHeaderCell(value).toLowerCase();

/** 헤더 칸이 이 필드의 별칭과 얼마나 맞는지. 0 = 안 맞음. 높을수록 확실. */
function aliasScore(header: string, field: LayoutField): { score: number; confidence: MatchConfidence | null } {
  const h = norm(header);
  if (!h) return { score: 0, confidence: null };
  const aliases = LAYOUT_ALIASES[field].map(norm);
  const exact = aliases.indexOf(h);
  if (exact !== -1) return { score: 1000 - exact, confidence: 'exact' };
  // 짧은 영어 별칭(qty, code 등)은 부분 일치로 오인하기 쉬워 3글자 이하는 부분 일치에 쓰지 않는다.
  const partial = aliases.findIndex((a) => a.length > 3 && h.includes(a));
  if (partial !== -1) return { score: 500 - partial, confidence: 'partial' };
  return { score: 0, confidence: null };
}

/** 위에서 15행 안에서 별칭이 가장 많이 맞는 행을 헤더로 본다. 하나도 안 맞으면 글자 칸이 가장 많은 행. */
export function detectHeaderRow(aoa: string[][]): number {
  const limit = Math.min(aoa.length, 15);
  let best = 0;
  let bestHits = 0;
  for (let i = 0; i < limit; i++) {
    const hits = LAYOUT_FIELDS.filter((f) => aoa[i].some((cell) => aliasScore(cell, f).score > 0)).length;
    if (hits > bestHits) {
      best = i;
      bestHits = hits;
    }
  }
  if (bestHits > 0) return best;
  let mostText = 0;
  for (let i = 0; i < limit; i++) {
    const textCells = aoa[i].filter((c) => normalizeString(c) !== '' && !/^-?[\d,.]+$/.test(normalizeString(c))).length;
    if (textCells > mostText) {
      mostText = textCells;
      best = i;
    }
  }
  return best;
}

export interface ColumnSuggestion {
  columns: Partial<Record<LayoutField, string | null>>;
  confidence: Partial<Record<LayoutField, MatchConfidence>>;
}

const isNumberLike = (value: string) => /^-?[\d,]+(\.\d+)?$/.test(normalizeString(value).replace(/원$/, ''));

/**
 * 헤더 이름으로 필드를 추천한다. 한 열은 한 필드에만 쓴다(점수가 높은 짝부터 배정).
 * 재고수량을 헤더로 못 찾으면, 값이 모두 정수인 열 중 하나를 '추정'으로 제안한다.
 */
export function suggestColumns(headers: string[], sampleRows: string[][]): ColumnSuggestion {
  const pairs: { field: LayoutField; col: number; score: number; confidence: MatchConfidence }[] = [];
  headers.forEach((header, col) => {
    for (const field of LAYOUT_FIELDS) {
      const { score, confidence } = aliasScore(header, field);
      if (score > 0 && confidence) pairs.push({ field, col, score, confidence });
    }
  });
  pairs.sort((a, b) => b.score - a.score);
  const columns: ColumnSuggestion['columns'] = {};
  const confidence: ColumnSuggestion['confidence'] = {};
  const usedCols = new Set<number>();
  for (const p of pairs) {
    if (columns[p.field] || usedCols.has(p.col)) continue;
    columns[p.field] = headers[p.col];
    confidence[p.field] = p.confidence;
    usedCols.add(p.col);
  }
  if (!columns.normalStock) {
    const candidate = headers.findIndex(
      (h, col) =>
        !usedCols.has(col) &&
        normalizeString(h) !== '' &&
        sampleRows.length > 0 &&
        sampleRows.every((r) => r[col] === undefined || r[col] === '' || /^-?[\d,]+$/.test(normalizeString(r[col]))),
    );
    if (candidate !== -1 && sampleRows.some((r) => isNumberLike(r[candidate] ?? ''))) {
      columns.normalStock = headers[candidate];
      confidence.normalStock = 'guess';
    }
  }
  return { columns, confidence };
}

/** 헤더 행의 지문 — 열 순서가 바뀌어도 같은 양식이면 같은 값이 나오도록 정렬해서 만든다. */
export function headerFingerprint(headers: string[]): string {
  return [...new Set(headers.map(norm).filter(Boolean))].sort().join('|');
}

/** 여러 형식의 날짜 칸을 yyyy-MM-dd로. 알아볼 수 없으면 null. */
export function parseDateCell(value: string): string | null {
  const v = normalizeString(value);
  if (!v) return null;
  let y: number, m: number, d: number;
  let match = v.match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = v.match(/^(\d{4})(\d{2})(\d{2})$/))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
    // 엑셀 기본 표시(월/일/연)
    y = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    [m, d] = [Number(match[1]), Number(match[2])];
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** 레이아웃의 헤더 이름을 실제 열 번호로 바꾼다. 헤더를 못 찾은 필드는 missing으로 돌려준다. */
export function resolveColumns(headers: string[], columns: ImportLayout['columns']): { indexes: Partial<Record<LayoutField, number>>; missing: LayoutField[] } {
  const normalized = headers.map(norm);
  const indexes: Partial<Record<LayoutField, number>> = {};
  const missing: LayoutField[] = [];
  for (const field of LAYOUT_FIELDS) {
    const header = columns[field];
    if (!header) continue;
    const idx = normalized.indexOf(norm(header));
    if (idx === -1) missing.push(field);
    else indexes[field] = idx;
  }
  return { indexes, missing };
}
