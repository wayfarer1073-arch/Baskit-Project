/**
 * 기간 일괄 업로드 계획 — 일자별 재고·입고 현황표를 "날짜마다 한 번의 재고 업로드 + 입고 기록"으로 바꾼다.
 *
 * 빈칸 해석: 재고 칸이 비어 있으면 그날 품절이거나 아직 등록 전인 SKU다. SKU마다 등록일을
 *   (창고에 이미 있던 SKU의 첫 등장일, 파일의 첫 재고일, 파일의 첫 입고일) 중 가장 이른 날로 보고,
 *   등록일 이후의 빈칸은 재고 0(품절), 등록일 전의 빈칸은 그날 목록에 넣지 않는다(미등록).
 * 기간 내내 재고·입고가 모두 비어 있고 창고에도 없던 SKU는 아예 올리지 않는다.
 */
import type { PeriodSheet } from '@/domain/excel/period-sheet';

/**
 * 기간 일괄 업로드로 만든 스냅샷의 파일명 머리말 — 날짜별 원본 파일이 없으므로 원본 내려받기 대신 안내를 보인다.
 * (직접 입력 실사의 MANUAL_COUNT_SOURCE처럼 파일명 자리로 출처를 구분한다.)
 */
export const PERIOD_UPLOAD_SOURCE_PREFIX = '기간 일괄 업로드 · ';
export const isPeriodUploadSource = (sourceFileName: string) => sourceFileName.startsWith(PERIOD_UPLOAD_SOURCE_PREFIX);

export type PeriodDateStatus = 'upload' | 'existing' | 'blocked' | 'future';

export interface PeriodPlanRow {
  code: string;
  name: string;
  stock: number;
  /** 빈칸을 품절(0)로 본 줄. */
  inferredZero: boolean;
}

export interface PeriodPlanDate {
  date: string;
  status: PeriodDateStatus;
  rows: PeriodPlanRow[];
}

export interface PeriodPlanInbound {
  code: string;
  name: string;
  date: string;
  quantity: number;
}

export interface PeriodPlan {
  dates: PeriodPlanDate[];
  inbound: PeriodPlanInbound[];
  /** 파일에 있는 SKU 수 / 기간 중 등록된 SKU 수 / 기간 내내 비어 있어 올리지 않는 SKU 수. */
  skuCount: number;
  registeredCount: number;
  emptyCount: number;
  /** 첫 재고보다 입고가 먼저여서 입고일부터 등록으로 본 SKU 수. */
  startedByInbound: number;
  /** 빈칸을 품절(0)로 채운 칸 수(올리는 날 기준). */
  inferredZeroCells: number;
  /** 재고 파일에도 창고에도 없어 입고를 붙일 수 없는 상품코드. */
  inboundUnknown: string[];
  /** 0 이하라 건너뛴 입고 칸 수. */
  inboundSkipped: number;
}

export interface PeriodPlanInput {
  stock: PeriodSheet | null;
  inbound: PeriodSheet | null;
  /** 창고에 이미 있는 SKU의 첫 등장일(상품코드 → 날짜). */
  knownFirstSeen: ReadonlyMap<string, string>;
  /** 이미 재고가 올라간 날짜 — overwrite가 아니면 건너뛴다. */
  existingDates: ReadonlySet<string>;
  /** 받지 않는 날(휴무일 업로드를 꺼 둔 경우의 주말·휴무일). */
  blockedDates: ReadonlySet<string>;
  overwrite: boolean;
  today: string;
}

const minDate = (a: string | undefined, b: string | undefined) => (a === undefined ? b : b === undefined ? a : a < b ? a : b);

export function buildPeriodPlan(input: PeriodPlanInput): PeriodPlan {
  const inboundByCode = new Map((input.inbound?.rows ?? []).map((r) => [r.code, r]));
  const stockRows = input.stock?.rows ?? [];
  const stockCodes = new Set(stockRows.map((r) => r.code));

  // SKU별 등록일.
  const startOf = new Map<string, string>();
  let startedByInbound = 0;
  for (const row of stockRows) {
    const firstStock = [...row.values.keys()].sort()[0];
    const firstInbound = [...(inboundByCode.get(row.code)?.values ?? new Map<string, number>()).entries()]
      .filter(([, q]) => q > 0)
      .map(([d]) => d)
      .sort()[0];
    const known = input.knownFirstSeen.get(row.code);
    const start = minDate(minDate(firstStock, firstInbound), known);
    if (start === undefined) continue;
    if (start === firstInbound && start !== firstStock && start !== known) startedByInbound++;
    startOf.set(row.code, start);
  }

  const dates: PeriodPlanDate[] = [];
  let inferredZeroCells = 0;
  for (const { date } of input.stock?.layout.dateCols ?? []) {
    const status: PeriodDateStatus =
      date > input.today ? 'future' : input.blockedDates.has(date) ? 'blocked' : input.existingDates.has(date) && !input.overwrite ? 'existing' : 'upload';
    const rows: PeriodPlanRow[] = [];
    for (const row of stockRows) {
      const start = startOf.get(row.code);
      if (start === undefined || date < start) continue;
      const value = row.values.get(date);
      rows.push({ code: row.code, name: row.name, stock: Math.max(0, Math.round(value ?? 0)), inferredZero: value === undefined });
    }
    if (status === 'upload') inferredZeroCells += rows.filter((r) => r.inferredZero).length;
    dates.push({ date, status, rows });
  }

  const inbound: PeriodPlanInbound[] = [];
  const unknown = new Set<string>();
  let inboundSkipped = 0;
  for (const row of input.inbound?.rows ?? []) {
    const known = stockCodes.has(row.code) ? startOf.has(row.code) : input.knownFirstSeen.has(row.code);
    for (const [date, quantity] of row.values) {
      if (quantity <= 0 || date > input.today) {
        inboundSkipped++;
        continue;
      }
      if (!known) {
        unknown.add(row.code);
        continue;
      }
      inbound.push({ code: row.code, name: row.name, date, quantity: Math.round(quantity) });
    }
  }
  inbound.sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));

  return {
    dates,
    inbound,
    skuCount: stockRows.length,
    registeredCount: startOf.size,
    emptyCount: stockRows.length - startOf.size,
    startedByInbound,
    inferredZeroCells,
    inboundUnknown: [...unknown].sort(),
    inboundSkipped,
  };
}

// ── 화면과 주고받는 요약(서버 → 화면) ──

export interface PeriodUploadPreview {
  stockFileName: string | null;
  inboundFileName: string | null;
  from: string | null;
  to: string | null;
  totalDays: number;
  uploadDays: number;
  existingDays: number;
  blockedDays: number;
  futureDays: number;
  skuCount: number;
  registeredCount: number;
  emptyCount: number;
  startedByInbound: number;
  inferredZeroCells: number;
  /** 올릴 입고 기록 수 / 그중 이미 같은 날 기록이 있는 수(채우기면 건너뜀, 덮어쓰기면 바꿈). */
  inboundEntries: number;
  inboundExisting: number;
  inboundFrom: string | null;
  inboundTo: string | null;
  inboundUnknown: string[];
  badCells: number;
  overwrite: boolean;
}

export interface PeriodUploadResult {
  kind: 'period';
  uploadedDays: number;
  skippedDays: number;
  inboundCreated: number;
  inboundUpdated: number;
  inboundSkipped: number;
  from: string | null;
  to: string | null;
}
