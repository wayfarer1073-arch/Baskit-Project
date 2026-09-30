import type { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { StockSegment } from '@/server/repositories/warehouse-repository';
import { dateOnlyToString } from '@/lib/date';
import type { ParsedExpirationRow } from '@/domain/excel/expiration-types';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface ExpirationLotRow {
  lotId: string;
  skuId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  lot: string;
  isAutoLot: boolean;
  expirationDate: string; // yyyy-MM-dd
  /** 소비기한 위험 판정 일수. SKU 단위 값이라 같은 SKU의 로트끼리는 항상 같다. null이면 앱 기본값을 쓴다. */
  expirationRiskDays: number | null;
}

function toDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** A, B, C, …, Z, AA, AB, … 순서의 n번째(0-indexed) 라벨을 반환한다 (엑셀 열 이름과 같은 방식). */
function labelAt(n: number): string {
  let num = n + 1;
  let s = '';
  while (num > 0) {
    num -= 1;
    s = String.fromCharCode(65 + (num % 26)) + s;
    num = Math.floor(num / 26);
  }
  return s;
}

/** 제외 대상(직접 입력된 로트명)과 겹치지 않는 라벨을 순서대로 count개 뽑는다. */
function generateAutoLabels(exclude: Set<string>, count: number): string[] {
  const labels: string[] = [];
  for (let n = 0; labels.length < count; n++) {
    const label = labelAt(n);
    if (!exclude.has(label)) labels.push(label);
  }
  return labels;
}

/** 오래된 데이터(로트 없이 Sku.expirationDate만 있던 시절) 하나를 로트 A로 옮겨 심는다. 멱등적이라 여러 번 불러도 안전하다. */
async function backfillLegacyExpirationDates(orgId: string): Promise<void> {
  const legacySkus = await prisma.sku.findMany({
    where: { warehouse: { organizationId: orgId, kind: 'STOCK' }, expirationDate: { not: null }, expirationLots: { none: {} } },
    select: { id: true, expirationDate: true },
  });
  if (legacySkus.length === 0) return;
  await prisma.$transaction(
    legacySkus.map((s) => prisma.skuExpirationLot.create({ data: { skuId: s.id, lot: 'A', isAutoLot: true, expirationDate: s.expirationDate! } })),
  );
}

/** skuId의 자동 배정 로트(isAutoLot)들을 소비기한 오름차순으로 재정렬해 A/B/C…를 다시 매긴다.
 *  직접 입력한 로트명은 건드리지 않고, 그 이름과 겹치지 않는 라벨만 자동 로트에 배정한다. */
async function relabelAutoLots(tx: Tx, skuId: string): Promise<void> {
  const lots = await tx.skuExpirationLot.findMany({ where: { skuId } });
  const manualLabels = new Set(lots.filter((l) => !l.isAutoLot).map((l) => l.lot));
  const autoLots = [...lots.filter((l) => l.isAutoLot)].sort(
    (a, b) => a.expirationDate.getTime() - b.expirationDate.getTime() || a.id.localeCompare(b.id),
  );
  if (autoLots.length === 0) return;

  const labels = generateAutoLabels(manualLabels, autoLots.length);
  // 겹치는 라벨로 잠깐이라도 unique 제약을 어기지 않도록, 먼저 임시 라벨로 옮긴 뒤 최종 라벨을 매긴다.
  await Promise.all(autoLots.map((lot) => tx.skuExpirationLot.update({ where: { id: lot.id }, data: { lot: `__tmp_${lot.id}` } })));
  await Promise.all(autoLots.map((lot, i) => tx.skuExpirationLot.update({ where: { id: lot.id }, data: { lot: labels[i] } })));
}

/** Sku.expirationDate 캐시를 이 SKU에 남은 로트 중 가장 이른 날짜로 다시 맞춘다(로트가 없으면 null). */
async function syncSkuExpirationDate(tx: Tx, skuId: string): Promise<void> {
  const soonest = await tx.skuExpirationLot.findFirst({ where: { skuId }, orderBy: { expirationDate: 'asc' } });
  await tx.sku.update({ where: { id: skuId }, data: { expirationDate: soonest ? soonest.expirationDate : null } });
}

/**
 * 재고 파일에 함께 적힌 소비기한으로 품목의 자동 로트를 맞춘다 — 파일에 있는 날짜는 자동 로트로 두고, 파일에 없어진 날짜의
 * 자동 로트는 지운다(그 로트가 다 나갔다고 본다). 이름을 직접 붙인 로트는 건드리지 않는다. 같은 파일을 다시 올려도 결과가 같다.
 */
export async function syncExpirationDatesFromStockFile(datesBySkuId: ReadonlyMap<string, string[]>): Promise<number> {
  let changed = 0;
  await prisma.$transaction(async (tx) => {
    for (const [skuId, dates] of datesBySkuId) {
      const wanted = new Set(dates);
      const lots = await tx.skuExpirationLot.findMany({ where: { skuId } });
      const autoLots = lots.filter((l) => l.isAutoLot);
      const namedDates = new Set(lots.filter((l) => !l.isAutoLot).map((l) => dateOnlyToString(l.expirationDate)));
      const stale = autoLots.filter((l) => !wanted.has(dateOnlyToString(l.expirationDate)));
      const have = new Set(autoLots.map((l) => dateOnlyToString(l.expirationDate)));
      const missing = [...wanted].filter((d) => !have.has(d) && !namedDates.has(d));
      if (stale.length === 0 && missing.length === 0) continue;
      if (stale.length) await tx.skuExpirationLot.deleteMany({ where: { id: { in: stale.map((l) => l.id) } } });
      for (const date of missing) {
        await tx.skuExpirationLot.create({ data: { skuId, lot: `__auto_${randomUUID()}`, isAutoLot: true, expirationDate: toDateOnly(date) } });
      }
      await relabelAutoLots(tx, skuId);
      await syncSkuExpirationDate(tx, skuId);
      changed++;
    }
  });
  return changed;
}

/** 최신 업로드에 남아 있고 로트가 하나 이상 등록된 SKU의 모든 로트를, 상품코드 순으로 나열한다(같은
 *  상품코드는 창고, 그 다음 소비기한 순으로 정렬). */
export async function listExpirationLots(orgId: string, segment?: StockSegment): Promise<ExpirationLotRow[]> {
  await backfillLegacyExpirationDates(orgId);

  const lots = await prisma.skuExpirationLot.findMany({
    where: { sku: { isActive: true, warehouse: { organizationId: orgId, isArchived: false, kind: 'STOCK', ...(segment ? { segment } : {}) } } },
    include: { sku: { include: { warehouse: { select: { code: true, name: true } } } } },
    orderBy: [{ sku: { productCode: 'asc' } }, { sku: { warehouse: { code: 'asc' } } }, { expirationDate: 'asc' }],
  });

  return lots.map((l) => ({
    lotId: l.id,
    skuId: l.skuId,
    warehouseId: l.sku.warehouseId,
    warehouseCode: l.sku.warehouse.code,
    warehouseName: l.sku.warehouse.name,
    productCode: l.sku.productCode,
    productName: l.sku.currentProductName,
    lot: l.lot,
    isAutoLot: l.isAutoLot,
    expirationDate: dateOnlyToString(l.expirationDate),
    expirationRiskDays: l.sku.expirationRiskDays,
  }));
}

export interface SkuExpirationLotSummary { lot: string; expirationDate: string }

/** SKU 상세 화면의 "상품 추가 정보" 카드용 — 이 SKU에 등록된 로트를 소비기한 오름차순으로 나열한다. */
export async function listExpirationLotsForSku(skuId: string): Promise<SkuExpirationLotSummary[]> {
  const lots = await prisma.skuExpirationLot.findMany({ where: { skuId }, orderBy: { expirationDate: 'asc' } });
  return lots.map((l) => ({ lot: l.lot, expirationDate: dateOnlyToString(l.expirationDate) }));
}

export interface ApplyExpirationResult {
  updatedCount: number;
  unmatchedProductCodes: string[];
}

/**
 * 파싱된 소비기한 행(한 행 = 한 로트)을 해당 창고에 이미 알려진(캘린더 업로드를 통해 한 번이라도
 * 인식된) SKU와 상품코드로 매칭해 반영한다. 로트명이 있으면 그 이름으로 upsert하고, 없으면 새 자동
 * 로트로 추가한 뒤 관련 SKU들의 라벨을 다시 매긴다. 그 창고에 없는 상품코드는 건너뛰고 목록으로 보고한다.
 */
export async function applyExpirationLotRows(warehouseId: string, rows: ParsedExpirationRow[]): Promise<ApplyExpirationResult> {
  if (rows.length === 0) return { updatedCount: 0, unmatchedProductCodes: [] };

  const skus = await prisma.sku.findMany({
    where: { warehouseId, isActive: true, productCode: { in: rows.map((r) => r.productCode) } },
    select: { id: true, productCode: true },
  });
  const skuIdByCode = new Map(skus.map((s) => [s.productCode, s.id]));

  const unmatchedProductCodes = new Set<string>();
  const affectedSkuIds = new Set<string>();
  let updatedCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const skuId = skuIdByCode.get(row.productCode);
      if (!skuId) {
        unmatchedProductCodes.add(row.productCode);
        continue;
      }
      const trimmedLot = row.lot?.trim() || null;
      if (trimmedLot) {
        await tx.skuExpirationLot.upsert({
          where: { skuId_lot: { skuId, lot: trimmedLot } },
          create: { skuId, lot: trimmedLot, isAutoLot: false, expirationDate: toDateOnly(row.expirationDate) },
          update: { isAutoLot: false, expirationDate: toDateOnly(row.expirationDate) },
        });
      } else {
        await tx.skuExpirationLot.create({
          data: { skuId, lot: `__auto_${randomUUID()}`, isAutoLot: true, expirationDate: toDateOnly(row.expirationDate) },
        });
      }
      affectedSkuIds.add(skuId);
      updatedCount += 1;
    }
    for (const skuId of affectedSkuIds) {
      await relabelAutoLots(tx, skuId);
      await syncSkuExpirationDate(tx, skuId);
    }
  });

  return { updatedCount, unmatchedProductCodes: [...unmatchedProductCodes] };
}

export type AddExpirationLotResult = { ok: true; lotId: string } | { ok: false; error: string };

/** 소비기한 관리 화면에서 로트 하나를 수동으로 추가한다. lot을 비우면 자동 배정(A/B/C…)된다. */
export async function addExpirationLot(orgId: string, skuId: string, lot: string | null, expirationDate: string): Promise<AddExpirationLotResult> {
  const sku = await prisma.sku.findFirst({ where: { id: skuId, warehouse: { organizationId: orgId } }, select: { id: true } });
  if (!sku) return { ok: false, error: 'SKU를 찾을 수 없습니다.' };

  const trimmedLot = lot?.trim() || null;
  try {
    const created = await prisma.$transaction(async (tx) => {
      if (trimmedLot) {
        const dup = await tx.skuExpirationLot.findUnique({ where: { skuId_lot: { skuId, lot: trimmedLot } } });
        if (dup) throw new Error('DUPLICATE_LOT');
      }
      const row = await tx.skuExpirationLot.create({
        data: { skuId, lot: trimmedLot ?? `__auto_${randomUUID()}`, isAutoLot: !trimmedLot, expirationDate: toDateOnly(expirationDate) },
      });
      await relabelAutoLots(tx, skuId);
      await syncSkuExpirationDate(tx, skuId);
      return row;
    });
    return { ok: true, lotId: created.id };
  } catch (e) {
    if (e instanceof Error && e.message === 'DUPLICATE_LOT') return { ok: false, error: '이미 같은 로트명이 등록되어 있습니다.' };
    throw e;
  }
}

export type MutateExpirationLotResult = { ok: true } | { ok: false; error: string };

/** 로트의 날짜 및/또는 로트명을 수정한다. lot을 명시적으로 null/빈 문자열로 보내면 자동 배정으로 되돌린다. */
export async function updateExpirationLot(
  orgId: string,
  lotId: string,
  data: { lot?: string | null; expirationDate?: string },
): Promise<MutateExpirationLotResult> {
  const existing = await prisma.skuExpirationLot.findFirst({ where: { id: lotId, sku: { warehouse: { organizationId: orgId } } } });
  if (!existing) return { ok: false, error: '로트를 찾을 수 없습니다.' };

  const skuId = existing.skuId;
  try {
    await prisma.$transaction(async (tx) => {
      const updateData: Prisma.SkuExpirationLotUpdateInput = {};
      if (data.expirationDate !== undefined) updateData.expirationDate = toDateOnly(data.expirationDate);
      if (data.lot !== undefined) {
        const trimmed = data.lot?.trim() || null;
        if (trimmed) {
          const dup = await tx.skuExpirationLot.findUnique({ where: { skuId_lot: { skuId, lot: trimmed } } });
          if (dup && dup.id !== lotId) throw new Error('DUPLICATE_LOT');
        }
        updateData.isAutoLot = !trimmed;
        updateData.lot = trimmed ?? `__auto_${randomUUID()}`;
      }
      await tx.skuExpirationLot.update({ where: { id: lotId }, data: updateData });
      await relabelAutoLots(tx, skuId);
      await syncSkuExpirationDate(tx, skuId);
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && e.message === 'DUPLICATE_LOT') return { ok: false, error: '이미 같은 로트명이 등록되어 있습니다.' };
    throw e;
  }
}

/** 로트를 삭제하고, 같은 SKU에 남은 자동 로트 라벨을 다시 매긴 뒤 대표 소비기한을 갱신한다. */
export async function deleteExpirationLot(orgId: string, lotId: string): Promise<boolean> {
  const existing = await prisma.skuExpirationLot.findFirst({ where: { id: lotId, sku: { warehouse: { organizationId: orgId } } } });
  if (!existing) return false;

  await prisma.$transaction(async (tx) => {
    await tx.skuExpirationLot.delete({ where: { id: lotId } });
    await relabelAutoLots(tx, existing.skuId);
    await syncSkuExpirationDate(tx, existing.skuId);
  });
  return true;
}

/** null을 넘기면 앱 기본값(자동계산)으로 되돌린다. */
export async function setExpirationRiskDays(orgId: string, skuId: string, riskDays: number | null): Promise<boolean> {
  const result = await prisma.sku.updateMany({
    where: { id: skuId, isActive: true, warehouse: { organizationId: orgId } },
    data: { expirationRiskDays: riskDays },
  });
  return result.count > 0;
}

/** 체크박스로 선택한 여러 SKU에 같은 위험 판정 일수를 한 번에 적용한다. */
export async function setExpirationRiskDaysBulk(orgId: string, skuIds: string[], riskDays: number): Promise<number> {
  if (skuIds.length === 0) return 0;
  const result = await prisma.sku.updateMany({
    where: { id: { in: skuIds }, isActive: true, warehouse: { organizationId: orgId } },
    data: { expirationRiskDays: riskDays },
  });
  return result.count;
}
