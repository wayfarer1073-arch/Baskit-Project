import { normalizeHeaderCell } from '@/domain/excel/aoa-reader';
import { isExampleRow } from '@/domain/excel/example-rows';

export interface ParsedSalesRow {
  date: string;
  amount: number;
}

const DATE_HEADERS = ['날짜', '일자', '매출일', '영업일', 'date', 'day'];
const AMOUNT_HEADERS = ['매출', '매출액', '금액', '매출금액', 'sales', 'amount', 'revenue'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function validDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** 엑셀·CSV에서 흔한 날짜 표기를 yyyy-MM-dd로 — 2026-09-01, 2026/9/1, 2026.09.01, 20260901, 9/1/26, 엑셀 날짜 일련번호. */
export function parseSalesDate(raw: string): string | null {
  const v = raw.trim().replace(/\s+/g, '');
  if (!v) return null;
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\.?$/);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const year = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    return validDate(year, Number(m[1]), Number(m[2]));
  }
  m = v.match(/^(\d{4})년(\d{1,2})월(\d{1,2})일$/);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  if (/^\d{5}$/.test(v)) {
    // 엑셀 날짜 일련번호(1900 날짜 체계).
    const date = new Date(Date.UTC(1899, 11, 30) + Number(v) * 86_400_000);
    return validDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  return null;
}

function parseAmount(raw: string): number | null {
  const v = raw.replace(/[,\s₩원]/g, '');
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  return Math.round(Number(v));
}

/**
 * 여러 날 매출 양식(날짜·매출 두 열)을 읽는다. 머리글이 있으면 그 열을, 없으면 앞의 두 열을 쓴다.
 * 날짜·금액을 읽을 수 없거나 오늘 이후인 줄은 건너뛰고, 같은 날짜가 여러 번 나오면 마지막 값을 쓴다.
 */
export function parseSalesAoa(aoa: string[][], today: string): { rows: ParsedSalesRow[]; skipped: number } {
  let dateCol = 0;
  let amountCol = 1;
  let start = 0;
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const cells = aoa[i].map((c) => normalizeHeaderCell(c).toLowerCase());
    const d = cells.findIndex((c) => DATE_HEADERS.includes(c));
    const a = cells.findIndex((c) => AMOUNT_HEADERS.includes(c));
    if (d !== -1 && a !== -1) {
      dateCol = d;
      amountCol = a;
      start = i + 1;
      break;
    }
  }
  const byDate = new Map<string, number>();
  let skipped = 0;
  for (const row of aoa.slice(start)) {
    const rawDate = row[dateCol] ?? '';
    const rawAmount = row[amountCol] ?? '';
    if (!rawDate.trim() && !rawAmount.trim()) continue;
    // 샘플 양식의 작성 방법·예시 행은 지우지 않고 올려도 건너뛴다.
    if (isExampleRow(row)) continue;
    const date = parseSalesDate(rawDate);
    const amount = parseAmount(rawAmount);
    if (!date || amount === null || date > today) {
      skipped++;
      continue;
    }
    byDate.set(date, amount);
  }
  return { rows: [...byDate].map(([date, amount]) => ({ date, amount })).sort((a, b) => (a.date < b.date ? -1 : 1)), skipped };
}
