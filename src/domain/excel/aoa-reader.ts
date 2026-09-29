import * as XLSX from 'xlsx';
import { decodeTextTable } from './text-encoding';

/**
 * 사내 Excel 익스포트 중 상당수가 실제로는 "HTML table을 .xls 확장자로 저장한" 파일이다
 * (사방넷류 ERP의 표준 익스포트 방식). SheetJS가 이를 못 읽는 경우를 대비해 직접 HTML 테이블 파서를
 * fallback으로 둔다. 재고 스냅샷 파서와 유통기한 파서가 공통으로 쓴다.
 */
function looksLikeHtmlTable(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 2048).toString('utf-8').toLowerCase();
  return head.includes('<html') || head.includes('<table');
}

function stripHtmlTags(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

function parseHtmlTableToAoa(text: string): string[][] {
  const rows: string[][] = [];
  const rowMatches = text.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  for (const rowHtml of rowMatches) {
    const cellMatches = rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? [];
    if (cellMatches.length === 0) continue;
    const cells = cellMatches.map((cellHtml) => {
      const inner = cellHtml.replace(/^<t[dh][^>]*>/i, '').replace(/<\/t[dh]>$/i, '');
      return stripHtmlTags(inner);
    });
    rows.push(cells);
  }
  return rows;
}

export function bufferToAoa(buffer: Buffer): string[][] {
  if (looksLikeHtmlTable(buffer)) {
    const text = buffer.toString('utf-8');
    const aoa = parseHtmlTableToAoa(text);
    if (aoa.length > 0) return aoa;
  }

  const textTable = decodeTextTable(buffer);
  const workbook = textTable ? XLSX.read(textTable.text, { type: 'string', raw: true }) : XLSX.read(buffer, { type: 'buffer', raw: false, cellText: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });
  return aoa.map((row) => row.map((cell) => (cell ?? '').toString()));
}

export function normalizeHeaderCell(value: string): string {
  return value.replace(/\s+/g, '').trim();
}

export function normalizeString(value: string | undefined | null): string {
  if (value === undefined || value === null) return '';
  return value.replace(/ /g, ' ').trim().replace(/\s+/g, ' ');
}

/** 헤더 별칭 맵을 기준으로, 별칭이 minHits개 이상 매치되는 첫 행을 헤더 행으로 본다. */
export function findHeaderRowIndex(aoa: string[][], headerAliases: Record<string, string[]>, minHits = 3): number {
  const fields = Object.keys(headerAliases);
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const normalized = aoa[i].map(normalizeHeaderCell);
    const hits = fields.filter((f) => headerAliases[f].some((alias) => normalized.includes(normalizeHeaderCell(alias))));
    if (hits.length >= minHits) return i;
  }
  return 0;
}

/**
 * 별칭 배열의 순서를 우선순위로 쓴다 — 헤더 행에 같은 필드를 가리키는 별칭이 여러 개
 * 있으면(예: "정상재고"와 "가용재고"가 한 시트에 함께 있는 경우), 시트 상 컬럼 위치가
 * 아니라 별칭 배열에서 먼저 나오는 쪽을 채택한다.
 */
export function buildHeaderMap<F extends string>(headerRow: string[], headerAliases: Record<F, string[]>, fields: readonly F[]): Partial<Record<F, string>> {
  const normalizedHeaders = headerRow.map(normalizeHeaderCell);
  const map: Partial<Record<F, string>> = {};
  for (const field of fields) {
    const aliases = headerAliases[field].map(normalizeHeaderCell);
    let matchedIdx = -1;
    for (const alias of aliases) {
      const idx = normalizedHeaders.indexOf(alias);
      if (idx !== -1) {
        matchedIdx = idx;
        break;
      }
    }
    if (matchedIdx !== -1) map[field] = headerRow[matchedIdx];
  }
  return map;
}
