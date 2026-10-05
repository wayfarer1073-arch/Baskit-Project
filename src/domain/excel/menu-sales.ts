import { normalizeHeaderCell, normalizeString } from './aoa-reader';
import { isExampleRow } from './example-rows';
import { parseDateCell } from './layout';

/**
 * 메뉴별 판매 파일(POS 상품별 매출 현황) 읽기.
 *
 * - 기본 인식은 OKPOS 등 POS가 흔히 쓰는 열 이름(상품명·판매수량·실매출액·영업일자…)으로 머리글 행과 열을 찾는다.
 *   POS 파일은 맨 위에 제목·조회기간·매장명 줄이 있고, 맨 아래 합계 줄이 붙는 경우가 많아 둘 다 건너뛴다.
 * - 이름이 다른 파일은 사용자가 열을 직접 고르고, 그 양식을 저장해 두면 같은 머리글의 파일에 자동으로 다시 쓴다.
 * - 날짜 열이 없으면 위쪽의 조회기간(하루짜리일 때)이나 사용자가 고른 날짜를 쓴다.
 */

export * from './menu-sales-fields';
import { MENU_SALES_ALIASES, MENU_SALES_FIELDS, REQUIRED_MENU_SALES_FIELDS, type MenuSalesField, type MenuSalesLayout } from './menu-sales-fields';

export interface ParsedMenuSale {
  date: string | null;
  code: string | null;
  name: string;
  quantity: number;
  amount: number | null;
}

export interface MenuSalesParseResult {
  headers: string[];
  rows: ParsedMenuSale[];
  /** 읽지 못하고 건너뛴 줄(합계·빈 줄 제외). */
  skipped: number;
  missing: MenuSalesField[];
}

const norm = (v: string) => normalizeHeaderCell(v).toLowerCase();
const HEADER_SCAN_ROWS = 30;
const TOTAL_ROW = /^(총?합계|소계|총계|계|total|subtotal|grandtotal)$/i;

function findColumn(headers: string[], aliases: string[]): number {
  const normalized = headers.map(norm);
  for (const alias of aliases) {
    const idx = normalized.indexOf(norm(alias));
    if (idx !== -1) return idx;
  }
  return -1;
}

/** 기본 인식 — 메뉴명과 수량 열을 모두 가진 첫 머리글 행(맞는 열이 가장 많은 행)을 찾는다. 못 찾으면 null. */
export function detectMenuSalesLayout(aoa: string[][]): MenuSalesLayout | null {
  let best: { index: number; hits: number } | null = null;
  for (let i = 0; i < Math.min(aoa.length, HEADER_SCAN_ROWS); i++) {
    const headers = aoa[i] ?? [];
    if (findColumn(headers, MENU_SALES_ALIASES.menuName) === -1 || findColumn(headers, MENU_SALES_ALIASES.quantity) === -1) continue;
    const hits = MENU_SALES_FIELDS.filter((f) => findColumn(headers, MENU_SALES_ALIASES[f]) !== -1).length;
    if (!best || hits > best.hits) best = { index: i, hits };
  }
  if (!best) return null;
  const headers = aoa[best.index];
  const columns: MenuSalesLayout['columns'] = {};
  for (const field of MENU_SALES_FIELDS) {
    const idx = findColumn(headers, MENU_SALES_ALIASES[field]);
    if (idx !== -1) columns[field] = headers[idx];
  }
  return { headerRowIndex: best.index, columns };
}

const DATE_TOKEN = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})|(\d{8})/g;

/**
 * 머리글 위 제목 줄의 조회기간에서 날짜를 찾는다 — 하루짜리(시작 = 끝)면 그 날짜, 여러 날이면 range로 알려 준다.
 * POS 파일은 날짜 열 없이 "조회기간 : 2026-10-01 ~ 2026-10-01"처럼 위에 적는 경우가 많다.
 */
export function findPeriod(aoa: string[][], headerRowIndex: number): { date: string | null; range: [string, string] | null } {
  const dates: string[] = [];
  for (let i = 0; i < headerRowIndex; i++) {
    for (const cell of aoa[i] ?? []) {
      for (const match of cell.matchAll(DATE_TOKEN)) {
        const parsed = parseDateCell(match[4] ?? `${match[1]}-${match[2]}-${match[3]}`);
        if (parsed) dates.push(parsed);
      }
    }
  }
  if (dates.length === 0) return { date: null, range: null };
  const sorted = [...new Set(dates)].sort();
  if (sorted.length === 1) return { date: sorted[0], range: null };
  return { date: null, range: [sorted[0], sorted[sorted.length - 1]] };
}

function parseNumber(raw: string): number | null {
  const v = normalizeString(raw).replace(/[,\s₩원개]/g, '');
  if (!v) return null;
  const negative = /^\(.*\)$/.test(v); // (3) 처럼 괄호로 적은 음수(반품·취소)
  const n = Number(v.replace(/[()]/g, ''));
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * 고른 양식으로 판매 줄을 읽는다. 합계·소계 줄과 예시 줄은 건너뛰고, 같은 날짜·같은 메뉴가 여러 줄이면 더한다
 * (반품·취소로 음수가 섞여 있어도 합친 값을 쓴다). 날짜 열이 없거나 비어 있으면 fallbackDate를 쓴다.
 */
export function parseMenuSales(aoa: string[][], layout: MenuSalesLayout, fallbackDate: string | null): MenuSalesParseResult {
  const headers = (aoa[layout.headerRowIndex] ?? []).map((h) => normalizeString(h));
  const index = {} as Record<MenuSalesField, number>;
  for (const field of MENU_SALES_FIELDS) {
    const name = layout.columns[field];
    index[field] = name ? headers.map(norm).indexOf(norm(name)) : -1;
  }
  const missing = REQUIRED_MENU_SALES_FIELDS.filter((f) => index[f] === -1);
  if (missing.length > 0) return { headers, rows: [], skipped: 0, missing };

  const merged = new Map<string, ParsedMenuSale>();
  let skipped = 0;
  for (const row of aoa.slice(layout.headerRowIndex + 1)) {
    const cell = (field: MenuSalesField) => (index[field] === -1 ? '' : normalizeString(row[index[field]] ?? ''));
    const name = cell('menuName');
    if (!name || row.every((c) => !normalizeString(c))) continue;
    if (TOTAL_ROW.test(name.replace(/\s+/g, '')) || isExampleRow(row)) continue;
    const quantity = parseNumber(cell('quantity'));
    if (quantity === null) {
      skipped++;
      continue;
    }
    const date = (index.date !== -1 ? parseDateCell(cell('date')) : null) ?? fallbackDate;
    const code = cell('menuCode') || null;
    const amount = index.amount === -1 ? null : parseNumber(cell('amount'));
    const key = `${date ?? ''}|${code ?? ''}|${name}`;
    const prev = merged.get(key);
    if (prev) {
      prev.quantity += quantity;
      prev.amount = prev.amount === null && amount === null ? null : (prev.amount ?? 0) + (amount ?? 0);
    } else {
      merged.set(key, { date, code, name, quantity, amount });
    }
  }
  const rows = [...merged.values()].filter((r) => r.quantity !== 0);
  return { headers, rows, skipped, missing: [] };
}
