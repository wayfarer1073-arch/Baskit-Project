/**
 * 기간 일괄 업로드 — "공급처 / 상품코드 / 상품명 + 날짜별 열(07-01, 07-02 …)" 모양의 일자별 재고·입고 현황표를 읽는다.
 *
 * 머리글 행에서 상품코드·상품명 열과 날짜 열을 찾는다. 날짜 머리글에 연도가 없으면(07-01) 기준일(오늘 또는 파일 이름의
 * 내려받은 날짜)에서 거슬러 올라가며 연도를 정한다 — 마지막 열이 기준일을 넘지 않고, 열이 왼쪽에서 오른쪽으로 날짜순이 되게.
 * 칸의 숫자는 그날 재고(또는 입고) 수량이고, 빈칸은 "그날 목록에 없음"이다 — 재고에서는 품절이거나 아직 등록 전인 SKU다.
 */
import { isDateString } from '@/lib/date';
import { normalizeHeaderCell } from '@/domain/excel/aoa-reader';

export const PERIOD_CODE_ALIASES = ['상품코드', '품목코드', 'SKU코드', 'SKU', '제품코드', '코드', 'productcode', 'code'];
export const PERIOD_NAME_ALIASES = ['상품명', '품목명', '제품명', 'SKU명', '상품이름', 'productname', 'name'];
export const PERIOD_SUPPLIER_ALIASES = ['공급처', '거래처', '공급사', '매입처', 'supplier'];

/** 한 파일에서 읽을 수 있는 날짜 열 수(1년 남짓). */
export const MAX_PERIOD_DATES = 400;

export interface PeriodSheetLayout {
  headerRowIndex: number;
  codeCol: number | null;
  nameCol: number | null;
  supplierCol: number | null;
  /** 날짜 열 — 왼쪽부터, 연도까지 정한 날짜. */
  dateCols: { col: number; date: string }[];
}

export interface PeriodSheetRow {
  code: string;
  name: string;
  supplier: string | null;
  /** 날짜 → 수량. 빈칸은 들어 있지 않다. */
  values: Map<string, number>;
}

export interface PeriodSheet {
  layout: PeriodSheetLayout;
  rows: PeriodSheetRow[];
  /** 숫자가 아니어서 건너뛴 칸 수. */
  badCells: number;
}

type HeaderDate = { year: number | null; month: number; day: number };

const pad = (n: number) => String(n).padStart(2, '0');

/** 날짜 머리글 하나를 읽는다 — 07-01, 7/1, 07.01, 7월 1일, 2026-07-01, 2026.7.1, 7/1/26(엑셀 날짜 칸). */
export function parseHeaderDate(raw: string): HeaderDate | null {
  const s = raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\([^)]*\)$/, '')
    .trim(); // "07-01(수)" 같은 요일 꼬리
  let m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/); // SheetJS가 날짜 칸을 m/d/yy로 보여 준다
  if (m) return valid(2000 + Number(m[3]), Number(m[1]), Number(m[2]));
  m = s.match(/^(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/);
  if (m) return valid(null, Number(m[1]), Number(m[2]));
  return null;
}

function valid(year: number | null, month: number, day: number): HeaderDate | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year !== null && !isDateString(`${year}-${pad(month)}-${pad(day)}`)) return null;
  return { year, month, day };
}

/**
 * 연도 없는 날짜 열들의 연도를 정한다. 마지막 열부터 거꾸로 — 마지막은 기준일 이하인 가장 가까운 해,
 * 그 앞 열은 뒤 열보다 이르도록(월·일이 뒤 열보다 크면 한 해 앞). 연도가 적힌 열은 그대로 쓴다.
 */
export function resolveYears(dates: HeaderDate[], referenceDate: string): string[] {
  const out: string[] = new Array(dates.length);
  const refYear = Number(referenceDate.slice(0, 4));
  let next: string | null = null;
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = dates[i];
    const md = `${pad(d.month)}-${pad(d.day)}`;
    let year: number;
    if (d.year !== null) year = d.year;
    else if (next === null) year = `${refYear}-${md}` <= referenceDate ? refYear : refYear - 1;
    else {
      year = Number(next.slice(0, 4));
      if (`${year}-${md}` >= next) year -= 1;
    }
    // 2월 29일처럼 그해에 없는 날이면 한 해씩 앞으로.
    while (!isDateString(`${year}-${md}`) && year > refYear - 10) year -= 1;
    out[i] = `${year}-${md}`;
    next = out[i];
  }
  return out;
}

/** 파일 이름에 붙은 내려받은 날짜(…_20261002165313…) — 연도 없는 날짜 열의 기준일로 쓴다. */
export function dateFromFileName(fileName: string): string | null {
  const m = fileName.match(/(20\d{2})(\d{2})(\d{2})(?:\d{6})?(?!\d)/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  return isDateString(date) ? date : null;
}

function findCol(header: string[], aliases: string[], skip: Set<number>): number | null {
  const normalized = header.map((h) => normalizeHeaderCell(h).toLowerCase());
  for (const alias of aliases) {
    const i = normalized.findIndex((h, idx) => !skip.has(idx) && h === normalizeHeaderCell(alias).toLowerCase());
    if (i !== -1) return i;
  }
  return null;
}

/** 머리글 행(위 10줄 중 날짜 열이 가장 많은 줄)과 열을 찾는다. 상품코드·상품명 중 하나와 날짜 열 2개 이상이 있어야 한다. */
export function detectPeriodSheet(aoa: string[][], referenceDate: string): PeriodSheetLayout | null {
  let best: { index: number; dates: { col: number; parsed: HeaderDate }[] } | null = null;
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const dates = (aoa[i] ?? []).map((cell, col) => ({ col, parsed: parseHeaderDate(cell ?? '') })).filter((d): d is { col: number; parsed: HeaderDate } => d.parsed !== null);
    if (dates.length >= 2 && (!best || dates.length > best.dates.length)) best = { index: i, dates };
  }
  if (!best) return null;
  const header = aoa[best.index].map((c) => c ?? '');
  const dateColSet = new Set(best.dates.map((d) => d.col));
  const codeCol = findCol(header, PERIOD_CODE_ALIASES, dateColSet);
  const nameCol = findCol(header, PERIOD_NAME_ALIASES, dateColSet);
  if (codeCol === null && nameCol === null) return null;
  const supplierCol = findCol(header, PERIOD_SUPPLIER_ALIASES, dateColSet);
  const dates = best.dates.slice(0, MAX_PERIOD_DATES);
  const resolved = resolveYears(
    dates.map((d) => d.parsed),
    referenceDate,
  );
  return { headerRowIndex: best.index, codeCol, nameCol, supplierCol, dateCols: dates.map((d, i) => ({ col: d.col, date: resolved[i] })) };
}

/** 칸의 수량 — "1,234", "12.0", "-" 등. 빈칸·대시는 null, 숫자가 아니면 NaN. */
export function cellQuantity(raw: string | undefined): number | null {
  const s = (raw ?? '').trim().replace(/,/g, '');
  if (s === '' || s === '-' || s === '—') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** 표 본문을 읽는다. 같은 상품코드가 여러 줄이면 날짜별로 더한다(창고·로케이션별로 나뉜 표). 합계 줄은 건너뛴다. */
export function parsePeriodSheet(aoa: string[][], layout: PeriodSheetLayout): PeriodSheet {
  const byKey = new Map<string, PeriodSheetRow>();
  let badCells = 0;
  for (const raw of aoa.slice(layout.headerRowIndex + 1)) {
    const code = layout.codeCol === null ? '' : (raw[layout.codeCol] ?? '').trim();
    const name = layout.nameCol === null ? '' : (raw[layout.nameCol] ?? '').trim().replace(/\s+/g, ' ');
    if (!code && !name) continue;
    if (/^(합\s*계|총\s*계|소\s*계|total)$/i.test(code || name)) continue;
    const key = code || `name:${name}`;
    const row = byKey.get(key) ?? { code, name, supplier: layout.supplierCol === null ? null : (raw[layout.supplierCol] ?? '').trim() || null, values: new Map<string, number>() };
    if (!row.name && name) row.name = name;
    for (const { col, date } of layout.dateCols) {
      const q = cellQuantity(raw[col]);
      if (q === null) continue;
      if (Number.isNaN(q)) {
        badCells++;
        continue;
      }
      row.values.set(date, (row.values.get(date) ?? 0) + q);
    }
    byKey.set(key, row);
  }
  return { layout, rows: [...byKey.values()], badCells };
}
