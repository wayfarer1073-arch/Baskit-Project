/**
 * 기간 일괄 업로드 — 일자별 재고 현황표(+ 일자별 입고 현황표)로 여러 날의 일일 재고와 입고를 한 번에 올린다.
 *
 * 날짜마다 일반 업로드와 같은 방식으로 재고 스냅샷을 만들고(빈칸 해석은 domain/excel/period-plan), 입고는 (SKU, 날짜) 입고 기록으로 남긴다.
 * 기본은 "아직 안 올린 날짜만 채우기" — 이미 올린 날짜의 재고와 이미 있는 입고 기록은 건드리지 않는다.
 * 덮어쓰기를 고르면 그 날짜의 재고를 이 파일로 바꾸고(새 버전), 입고 수량도 파일 값으로 바꾼다.
 */
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { todayKstDateString, dateOnlyToString } from '@/lib/date';
import { isShippingDay } from '@/domain/inventory/shipping-calendar';
import { markZeroStock } from '@/domain/excel/normalize';
import { dateFromFileName, detectPeriodSheet, parsePeriodSheet, type PeriodSheet } from '@/domain/excel/period-sheet';
import { buildPeriodPlan, PERIOD_UPLOAD_SOURCE_PREFIX, type PeriodPlan, type PeriodPlanRow, type PeriodUploadPreview, type PeriodUploadResult } from '@/domain/excel/period-plan';
export type { PeriodUploadPreview, PeriodUploadResult };
import type { ParsedInventoryRow } from '@/domain/excel/types';
import { getSegmentSettings } from '@/server/repositories/settings-repository';
import { listHolidayDateStrings } from '@/server/repositories/holiday-repository';
import { loadAliasMap } from '@/server/repositories/code-alias-repository';
import { createSnapshot, SnapshotConflictError } from '@/server/repositories/snapshot-repository';
import { manualRowsForDate } from '@/server/repositories/count-repository';

export class PeriodFileError extends Error {}

export interface PeriodFileInput {
  aoa: string[][];
  fileName: string;
}

export interface PeriodUploadInput {
  orgId: string;
  warehouseId: string;
  userId: string;
  stock: PeriodFileInput | null;
  inbound: PeriodFileInput | null;
  overwrite: boolean;
}

/** 파일 하나를 표로 읽는다 — 연도 없는 날짜 열은 파일 이름의 날짜(없으면 오늘)를 기준으로 연도를 붙인다. */
export function readPeriodFile(file: PeriodFileInput, today = todayKstDateString()): PeriodSheet {
  const fromName = dateFromFileName(file.fileName);
  const reference = fromName && fromName < today ? fromName : today;
  const layout = detectPeriodSheet(file.aoa, reference);
  if (!layout)
    throw new PeriodFileError(`${file.fileName}: 날짜 열(예: 07-01)과 상품코드·상품명 열을 찾지 못했어요. 첫 줄에 상품코드·상품명과 날짜가 있는 일자별 현황표인지 확인해 주세요.`);
  if (layout.codeCol === null) throw new PeriodFileError(`${file.fileName}: 상품코드 열이 필요해요(날짜마다 같은 상품을 맞추는 데 써요).`);
  return parsePeriodSheet(file.aoa, layout);
}

/** 연결된 상품코드(다른 코드 → 기존 SKU)를 적용한다. 같은 SKU로 모이는 줄은 날짜별로 더한다. */
function applyAliases(sheet: PeriodSheet | null, aliases: Map<string, string>): PeriodSheet | null {
  if (!sheet || aliases.size === 0) return sheet;
  const merged = new Map<string, PeriodSheet['rows'][number]>();
  for (const row of sheet.rows) {
    const code = aliases.get(row.code) ?? row.code;
    const existing = merged.get(code);
    if (!existing) {
      merged.set(code, { ...row, code, values: new Map(row.values) });
      continue;
    }
    for (const [d, q] of row.values) existing.values.set(d, (existing.values.get(d) ?? 0) + q);
  }
  return { ...sheet, rows: [...merged.values()] };
}

function dateRange(sheet: PeriodSheet | null) {
  const cols = sheet?.layout.dateCols ?? [];
  return cols.length ? { from: cols[0].date, to: cols[cols.length - 1].date } : null;
}

async function buildContext(input: PeriodUploadInput) {
  const today = todayKstDateString();
  const aliases = await loadAliasMap(input.warehouseId);
  const stock = applyAliases(input.stock ? readPeriodFile(input.stock, today) : null, aliases);
  const inbound = applyAliases(input.inbound ? readPeriodFile(input.inbound, today) : null, aliases);
  if (!stock && !inbound) throw new PeriodFileError('재고 현황표나 입고 현황표 중 하나는 올려 주세요.');

  const stockRange = dateRange(stock);
  const [skus, snapshots, settings, holidays] = await Promise.all([
    prisma.sku.findMany({ where: { warehouseId: input.warehouseId }, select: { id: true, productCode: true, firstSeenDate: true } }),
    stockRange
      ? prisma.inventorySnapshot.findMany({
          where: { warehouseId: input.warehouseId, status: 'ACTIVE', snapshotDate: { gte: new Date(`${stockRange.from}T00:00:00Z`), lte: new Date(`${stockRange.to}T00:00:00Z`) } },
          select: { snapshotDate: true },
        })
      : Promise.resolve([]),
    getSegmentSettings(input.orgId),
    listHolidayDateStrings(input.orgId),
  ]);
  const knownFirstSeen = new Map(skus.map((s) => [s.productCode, dateOnlyToString(s.firstSeenDate)]));
  const existingDates = new Set(snapshots.map((s) => dateOnlyToString(s.snapshotDate)));
  const holidaySet = new Set(holidays);
  const blockedDates = new Set(settings.allowNonWorkingDayUploads ? [] : (stock?.layout.dateCols ?? []).map((d) => d.date).filter((d) => !isShippingDay(d, holidaySet)));
  const plan = buildPeriodPlan({ stock, inbound, knownFirstSeen, existingDates, blockedDates, overwrite: input.overwrite, today });
  return { stock, inbound, plan, skus };
}

/** 이미 같은 (SKU, 날짜)에 입고 기록이 있는 항목 — 채우기면 건너뛰고 덮어쓰기면 바꾼다. */
async function existingInboundKeys(warehouseId: string, plan: PeriodPlan): Promise<Set<string>> {
  if (plan.inbound.length === 0) return new Set();
  const dates = plan.inbound.map((e) => e.date);
  const rows = await prisma.snapshotInbound.findMany({
    where: {
      sku: { warehouseId, productCode: { in: [...new Set(plan.inbound.map((e) => e.code))] } },
      snapshotDate: { gte: new Date(`${dates[0]}T00:00:00Z`), lte: new Date(`${dates[dates.length - 1]}T00:00:00Z`) },
    },
    select: { snapshotDate: true, sku: { select: { productCode: true } } },
  });
  return new Set(rows.map((r) => `${r.sku.productCode}|${dateOnlyToString(r.snapshotDate)}`));
}

export async function previewPeriodUpload(input: PeriodUploadInput): Promise<PeriodUploadPreview> {
  const { stock, inbound, plan } = await buildContext(input);
  const range = dateRange(stock);
  const existingInbound = await existingInboundKeys(input.warehouseId, plan);
  const count = (status: string) => plan.dates.filter((d) => d.status === status).length;
  return {
    stockFileName: input.stock?.fileName ?? null,
    inboundFileName: input.inbound?.fileName ?? null,
    from: range?.from ?? null,
    to: range?.to ?? null,
    totalDays: plan.dates.length,
    uploadDays: count('upload'),
    existingDays: count('existing'),
    blockedDays: count('blocked'),
    futureDays: count('future'),
    skuCount: plan.skuCount,
    registeredCount: plan.registeredCount,
    emptyCount: plan.emptyCount,
    startedByInbound: plan.startedByInbound,
    inferredZeroCells: plan.inferredZeroCells,
    inboundEntries: plan.inbound.length,
    inboundExisting: plan.inbound.filter((e) => existingInbound.has(`${e.code}|${e.date}`)).length,
    inboundFrom: plan.inbound[0]?.date ?? null,
    inboundTo: plan.inbound.at(-1)?.date ?? null,
    inboundUnknown: plan.inboundUnknown,
    badCells: (stock?.badCells ?? 0) + (inbound?.badCells ?? 0),
    overwrite: input.overwrite,
  };
}

function toParsedRow(row: PeriodPlanRow, index: number): ParsedInventoryRow {
  return {
    rowNumber: index + 1,
    productCode: row.code,
    productName: row.name || row.code,
    option: null,
    barcode: null,
    unitCost: 0,
    totalCost: null,
    normalStock: row.stock,
    availableStock: row.stock,
    incomingStock: 0,
    defectiveStock: 0,
    warningQty: 0,
    dangerQty: 0,
    location: null,
    category: null,
    extra: {},
    // 원가는 파일에 없으니 SKU의 기존 원가를 이어받는다.
    costMissing: true,
  };
}

const signature = (rows: PeriodPlanRow[]) =>
  createHash('sha256')
    .update(JSON.stringify(rows.map((r) => [r.code, r.name, r.stock]).sort()))
    .digest('hex');

/**
 * 계획대로 저장한다 — 날짜순으로 재고 스냅샷을 만들고(오래된 날부터라 마지막 날이 최신 상태가 된다) 입고 기록을 남긴다.
 * onProgress로 처리한 날 수를 알린다(작업 상태 화면용).
 */
export async function runPeriodUpload(input: PeriodUploadInput, onProgress?: (done: number, total: number) => Promise<void>): Promise<PeriodUploadResult> {
  const { stock, plan } = await buildContext(input);
  const range = dateRange(stock);
  const fileName = input.stock?.fileName ?? input.inbound?.fileName ?? '';
  const targets = plan.dates.filter((d) => d.status === 'upload' && d.rows.length > 0);
  let uploadedDays = 0;
  let skippedDays = 0;
  for (const [i, day] of targets.entries()) {
    const snapshotDate = new Date(`${day.date}T00:00:00.000Z`);
    let rows = markZeroStock(day.rows.map(toParsedRow), undefined);
    if (input.overwrite) {
      // 같은 날 직접 입력한 상품 중 이 파일에 없는 것은 남긴다(일반 업로드의 교체와 같은 규칙).
      const codes = new Set(rows.map((r) => r.productCode));
      const kept = (await manualRowsForDate(input.warehouseId, snapshotDate)).filter((r) => !codes.has(r.productCode));
      rows = [...rows, ...kept.map((r, k) => ({ ...r, rowNumber: rows.length + k + 1 }))];
    }
    try {
      await createSnapshot({
        warehouseId: input.warehouseId,
        snapshotDate,
        sourceFileName: `${PERIOD_UPLOAD_SOURCE_PREFIX}${fileName} · ${day.date.slice(5)}`,
        fileHash: signature(day.rows),
        uploadedById: input.userId,
        rows,
        replaceExisting: input.overwrite,
      });
      uploadedDays++;
    } catch (e) {
      // 미리보기 뒤에 다른 업로드가 그날을 먼저 채웠다 — 채우기 모드에서는 그대로 둔다.
      if (!(e instanceof SnapshotConflictError)) throw e;
      skippedDays++;
    }
    if (onProgress && (i % 5 === 4 || i === targets.length - 1)) await onProgress(i + 1, targets.length);
  }

  // 입고 — 재고를 먼저 올려 SKU가 생긴 뒤에 붙인다.
  let inboundCreated = 0;
  let inboundUpdated = 0;
  let inboundSkipped = 0;
  if (plan.inbound.length > 0) {
    const skus = await prisma.sku.findMany({
      where: { warehouseId: input.warehouseId, productCode: { in: [...new Set(plan.inbound.map((e) => e.code))] } },
      select: { id: true, productCode: true, currentProductName: true },
    });
    const skuByCode = new Map(skus.map((s) => [s.productCode, s]));
    const existing = await existingInboundKeys(input.warehouseId, plan);
    const creates: Prisma.SnapshotInboundCreateManyInput[] = [];
    const updates: { skuId: string; date: string; quantity: number }[] = [];
    for (const entry of plan.inbound) {
      const sku = skuByCode.get(entry.code);
      if (!sku) {
        inboundSkipped++;
        continue;
      }
      if (existing.has(`${entry.code}|${entry.date}`)) {
        if (input.overwrite) updates.push({ skuId: sku.id, date: entry.date, quantity: entry.quantity });
        else inboundSkipped++;
        continue;
      }
      creates.push({
        skuId: sku.id,
        snapshotDate: new Date(`${entry.date}T00:00:00.000Z`),
        productCode: sku.productCode,
        productName: sku.currentProductName,
        quantity: entry.quantity,
      });
    }
    if (creates.length) inboundCreated = (await prisma.snapshotInbound.createMany({ data: creates, skipDuplicates: true })).count;
    inboundSkipped += creates.length - inboundCreated;
    if (updates.length) {
      await prisma.$transaction(
        updates.map((u) =>
          prisma.snapshotInbound.update({ where: { skuId_snapshotDate: { skuId: u.skuId, snapshotDate: new Date(`${u.date}T00:00:00.000Z`) } }, data: { quantity: u.quantity } }),
        ),
      );
      inboundUpdated = updates.length;
    }
  }

  return {
    kind: 'period',
    uploadedDays,
    skippedDays,
    inboundCreated,
    inboundUpdated,
    inboundSkipped,
    from: range?.from ?? plan.inbound[0]?.date ?? null,
    to: range?.to ?? plan.inbound.at(-1)?.date ?? null,
  };
}
