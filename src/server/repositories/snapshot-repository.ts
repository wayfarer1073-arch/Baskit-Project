import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { ParsedInventoryRow } from '@/domain/excel/types';
import { realignSkuAttributes, recordSkuAttributes } from '@/server/repositories/sku-attribute-repository';
import { removeStoredFiles, storageKeysFor } from '@/server/repositories/upload-file-repository';

export function findActiveSnapshot(warehouseId: string, snapshotDate: Date) {
  return prisma.inventorySnapshot.findFirst({
    where: { warehouseId, snapshotDate, status: 'ACTIVE' },
    include: { uploadedBy: { select: { name: true, email: true } } },
  });
}

export function getLatestActiveSnapshot(warehouseId: string) {
  return prisma.inventorySnapshot.findFirst({
    where: { warehouseId, status: 'ACTIVE' },
    orderBy: { snapshotDate: 'desc' },
  });
}

export function getLatestActiveSnapshotBefore(warehouseId: string, beforeDate: Date) {
  return prisma.inventorySnapshot.findFirst({
    where: { warehouseId, status: 'ACTIVE', snapshotDate: { lt: beforeDate } },
    orderBy: { snapshotDate: 'desc' },
  });
}

export async function getSnapshotProductCodes(snapshotId: string): Promise<string[]> {
  const items = await prisma.inventoryItem.findMany({ where: { snapshotId }, select: { sku: { select: { productCode: true } } } });
  return items.map((i) => i.sku.productCode);
}

export interface CreateSnapshotInput {
  warehouseId: string;
  snapshotDate: Date;
  sourceFileName: string;
  fileHash: string;
  uploadedById: string;
  isMock?: boolean;
  rows: ParsedInventoryRow[];
  replaceExisting?: boolean;
  /** 일부 SKU만 센 실사(직접 입력)면 true — 이번에 빠진 SKU를 품절로 보지 않는다. */
  partial?: boolean;
}

export class SnapshotConflictError extends Error {
  constructor() { super('A snapshot was created before this upload acquired the warehouse lock.'); }
}

/**
 * 같은 (창고, 기준일)에 이미 ACTIVE 스냅샷이 있으면 REPLACED로 남기고 새 버전을 만든다. 이전 버전은 누가 언제 올렸는지와
 * 원본 파일만 남기고 재고 행은 바로 지운다(어디서도 읽지 않는 행이라 공간만 차지한다). 이 스냅샷이 해당 창고의 가장 최신 스냅샷일 때만 "사라진 SKU"의 isActive를 갱신한다
 * (과거 날짜 스냅샷을 나중에 업로드해도 최신 상태 판정이 흔들리지 않도록).
 */
export async function createSnapshot(input: CreateSnapshotInput) {
  return prisma.$transaction(
    async (tx) => {
      // Serialize uploads per warehouse, not just per date: concurrent dates also update
      // the same current-SKU cache. Holding this parent lock makes version allocation safe.
      await tx.$queryRaw`SELECT id FROM warehouses WHERE id = ${input.warehouseId} FOR UPDATE`;
      const existing = await tx.inventorySnapshot.findFirst({
        where: { warehouseId: input.warehouseId, snapshotDate: input.snapshotDate, status: 'ACTIVE' },
      });

      let version = 1;
      let replacedSkuIds: string[] = [];
      if (existing) {
        if (input.replaceExisting === false) throw new SnapshotConflictError();
        await tx.inventorySnapshot.update({ where: { id: existing.id }, data: { status: 'REPLACED' } });
        replacedSkuIds = (await tx.inventoryItem.findMany({ where: { snapshotId: existing.id }, select: { skuId: true } })).map((i) => i.skuId);
        await tx.inventoryItem.deleteMany({ where: { snapshotId: existing.id } });
        version = existing.version + 1;
      }

      const snapshot = await tx.inventorySnapshot.create({
        data: {
          warehouseId: input.warehouseId,
          snapshotDate: input.snapshotDate,
          version,
          status: 'ACTIVE',
          sourceFileName: input.sourceFileName,
          fileHash: input.fileHash,
          rowCount: input.rows.length,
          isMock: input.isMock ?? false,
          uploadedById: input.uploadedById,
        },
      });

      const latestOther = await tx.inventorySnapshot.findFirst({
        where: { warehouseId: input.warehouseId, status: 'ACTIVE', id: { not: snapshot.id } },
        orderBy: { snapshotDate: 'desc' },
      });
      const isLatestSnapshot = !latestOther || latestOther.snapshotDate <= input.snapshotDate;

      // Batch inserts and updates avoid two database round trips for every Excel row.
      const touchedSkuIds: string[] = [];
      for (let offset = 0; offset < input.rows.length; offset += 1000) {
        const batch = input.rows.slice(offset, offset + 1000);
        await tx.sku.createMany({ skipDuplicates: true, data: batch.map((row) => ({
            warehouseId: input.warehouseId,
            productCode: row.productCode,
            currentProductName: row.productName,
            currentOption: row.option,
            currentBarcode: row.barcode,
            currentLocation: row.location,
            currentUnitCost: row.costMissing ? 0 : row.unitCost,
            unitCostSource: row.costMissing ? null : 'FILE',
            unitCostUpdatedAt: row.costMissing ? null : new Date(),
            currentWarningQty: row.warningQty,
            currentDangerQty: row.dangerQty,
            firstSeenDate: input.snapshotDate,
            lastSeenDate: input.snapshotDate,
            // 재고 0으로 품절·관리 제외된 행은 처음부터 관리 목록 밖에 둔다.
            isActive: isLatestSnapshot && !row.zeroStockStatus,
            soldOutDetectedDate: isLatestSnapshot && row.zeroStockStatus === 'soldOut' ? input.snapshotDate : null,
            removedDate: isLatestSnapshot && row.zeroStockStatus === 'removed' ? input.snapshotDate : null,
        })) });

        const payload = JSON.stringify(batch);
        await tx.$executeRaw`
          UPDATE skus AS s SET
            "firstSeenDate" = LEAST(s."firstSeenDate", ${input.snapshotDate}::date),
            "lastSeenDate" = GREATEST(s."lastSeenDate", ${input.snapshotDate}::date),
            "currentProductName" = CASE WHEN ${isLatestSnapshot} THEN r."productName" ELSE s."currentProductName" END,
            "currentOption" = CASE WHEN ${isLatestSnapshot} THEN r.option ELSE s."currentOption" END,
            "currentBarcode" = CASE WHEN ${isLatestSnapshot} THEN r.barcode ELSE s."currentBarcode" END,
            "currentLocation" = CASE WHEN ${isLatestSnapshot} THEN r.location ELSE s."currentLocation" END,
            "currentUnitCost" = CASE WHEN ${isLatestSnapshot} AND NOT r."costMissing" THEN r."unitCost" ELSE s."currentUnitCost" END,
            "unitCostSource" = CASE WHEN ${isLatestSnapshot} AND NOT r."costMissing" THEN 'FILE'::"CostSource" ELSE s."unitCostSource" END,
            "unitCostUpdatedAt" = CASE WHEN ${isLatestSnapshot} AND NOT r."costMissing" THEN NOW() ELSE s."unitCostUpdatedAt" END,
            "currentWarningQty" = CASE WHEN ${isLatestSnapshot} THEN r."warningQty" ELSE s."currentWarningQty" END,
            "currentDangerQty" = CASE WHEN ${isLatestSnapshot} THEN r."dangerQty" ELSE s."currentDangerQty" END,
            "isActive" = CASE WHEN ${isLatestSnapshot} THEN r."zeroStockStatus" IS NULL ELSE s."isActive" END,
            -- 재고 0이 이어지는 동안은 처음 품절·제외된 날짜를 유지한다(180일 노출 기간의 시작점).
            "soldOutDetectedDate" = CASE WHEN ${isLatestSnapshot} THEN (CASE WHEN r."zeroStockStatus" = 'soldOut' THEN COALESCE(s."soldOutDetectedDate", ${input.snapshotDate}::date) ELSE NULL END) ELSE s."soldOutDetectedDate" END,
            "removedDate" = CASE WHEN ${isLatestSnapshot} THEN (CASE WHEN r."zeroStockStatus" = 'removed' THEN COALESCE(s."removedDate", ${input.snapshotDate}::date) ELSE NULL END) ELSE s."removedDate" END,
            "updatedAt" = NOW()
          FROM jsonb_to_recordset(${payload}::jsonb) AS r(
            "productCode" text, "productName" text, option text, barcode text, location text,
            "costMissing" boolean, "unitCost" numeric, "warningQty" integer, "dangerQty" integer, "zeroStockStatus" text
          )
          WHERE s."warehouseId" = ${input.warehouseId} AND s."productCode" = r."productCode"
        `;
        const skus = await tx.sku.findMany({
          where: { warehouseId: input.warehouseId, productCode: { in: batch.map(r => r.productCode) } },
          select: { id: true, productCode: true },
        });
        const skuIdByCode = new Map(skus.map(s => [s.productCode, s.id]));
        touchedSkuIds.push(...skus.map(s => s.id));
        await tx.inventoryItem.createMany({ data: batch.map((row) => ({
            snapshotId: snapshot.id,
            skuId: skuIdByCode.get(row.productCode)!,
            unitCost: row.unitCost,
            unitCostProvided: !row.costMissing,
            totalCost: row.totalCost,
            normalStock: row.normalStock,
            defectiveStock: row.defectiveStock,
            incomingStock: row.incomingStock,
            ...(Object.keys(row.extra).length > 0 ? { extra: row.extra as Prisma.InputJsonValue } : {}),
        })) });
        // 상품명·옵션 등은 그 날짜에 효력 있는 값과 다를 때만 변경 이력에 남긴다.
        await recordSkuAttributes(tx, input.snapshotDate, batch.map((row) => ({
          skuId: skuIdByCode.get(row.productCode)!,
          attributes: { productName: row.productName, option: row.option, barcode: row.barcode, location: row.location, warningQty: row.warningQty, dangerQty: row.dangerQty },
        })));
      }

      // 다시 올린 목록에서 빠진 품목은 그 날짜의 관측이 사라졌으므로 그날 남긴 속성 버전을 정리한다.
      const dropped = replacedSkuIds.filter((id) => !touchedSkuIds.includes(id));
      if (dropped.length > 0) await realignSkuAttributes(tx, input.warehouseId, input.snapshotDate, dropped);

      if (isLatestSnapshot && touchedSkuIds.length > 0 && !input.partial) {
        // 직전까지 활성이던 SKU가 이번 최신 스냅샷에는 없다 — "다음 업로드 목록에서 빠짐" =
        // 품절로 인식하고, 그 시점을 이 스냅샷의 기준일로 기록한다(유예기간 계산의 시작점).
        await tx.sku.updateMany({
          where: { warehouseId: input.warehouseId, isActive: true, id: { notIn: touchedSkuIds } },
          data: { isActive: false, soldOutDetectedDate: input.snapshotDate },
        });
      }

      return snapshot;
    },
    { timeout: 60000, maxWait: 15000 },
  );
}

/**
 * 특정 창고·날짜에 업로드된 자료를 완전히 지운다(ACTIVE/REPLACED 이력 전부, cascade로
 * InventoryItem도 함께 삭제). 같은 날짜의 수동 입고 기록(SnapshotInbound)도 함께 지운다.
 * 지운 날짜가 그 창고의 최신 스냅샷이었다면, 남은 스냅샷 중 최신 것으로 SKU 캐시(isActive/
 * current*)를 다시 맞추고, 모든 SKU의 firstSeenDate/lastSeenDate를 남은 데이터로 재계산한다.
 */
export async function resetUploadForDate(warehouseId: string, snapshotDate: Date): Promise<{ deletedSnapshotCount: number }> {
  const fileKeys: string[] = [];
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM warehouses WHERE id = ${warehouseId} FOR UPDATE`;

      const toDelete = await tx.inventorySnapshot.findMany({ where: { warehouseId, snapshotDate }, select: { id: true } });
      if (toDelete.length === 0) return { deletedSnapshotCount: 0 };

      const skusInWarehouse = await tx.sku.findMany({ where: { warehouseId }, select: { id: true } });
      const skuIds = skusInWarehouse.map((s) => s.id);
      if (skuIds.length > 0) {
        await tx.snapshotInbound.deleteMany({ where: { snapshotDate, skuId: { in: skuIds } } });
      }

      fileKeys.push(...(await storageKeysFor({ snapshotId: { in: toDelete.map((s) => s.id) } }, tx)));
      await tx.inventorySnapshot.deleteMany({ where: { id: { in: toDelete.map((s) => s.id) } } });
      await realignSkuAttributes(tx, warehouseId, snapshotDate);

      const newLatest = await tx.inventorySnapshot.findFirst({
        where: { warehouseId, status: 'ACTIVE' },
        orderBy: { snapshotDate: 'desc' },
      });

      if (newLatest) {
        // 상품 속성은 남은 최신 날짜에 효력 있는 버전(그 날짜 이하 중 가장 최근)으로 되돌린다.
        await tx.$executeRaw`
          UPDATE skus AS s SET
            "currentProductName" = v."productName",
            "currentOption" = v.option,
            "currentBarcode" = v.barcode,
            "currentLocation" = v.location,
            "currentWarningQty" = v."warningQty",
            "currentDangerQty" = v."dangerQty",
            "updatedAt" = NOW()
          FROM (
            SELECT DISTINCT ON (a."skuId") a.* FROM sku_attribute_versions a
            JOIN inventory_items ii ON ii."skuId" = a."skuId" AND ii."snapshotId" = ${newLatest.id}
            WHERE a."effectiveDate" <= ${newLatest.snapshotDate}
            ORDER BY a."skuId", a."effectiveDate" DESC
          ) AS v
          WHERE s.id = v."skuId"
        `;
        await tx.$executeRaw`
          UPDATE skus AS s SET
            "currentUnitCost" = CASE WHEN ii."unitCostProvided" THEN ii."unitCost" ELSE s."currentUnitCost" END,
            "unitCostSource" = CASE WHEN ii."unitCostProvided" THEN (CASE WHEN ii.extra ? 'manualCost' THEN 'MANUAL' ELSE 'FILE' END)::"CostSource" ELSE s."unitCostSource" END,
            "isActive" = NOT COALESCE(ii.extra ? 'stockStatus', false),
            "soldOutDetectedDate" = CASE WHEN ii.extra->>'stockStatus' = 'soldOut' THEN COALESCE(s."soldOutDetectedDate", ${newLatest.snapshotDate}) ELSE NULL END,
            "removedDate" = CASE WHEN ii.extra->>'stockStatus' = 'removed' THEN COALESCE(s."removedDate", ${newLatest.snapshotDate}) ELSE NULL END,
            "updatedAt" = NOW()
          FROM inventory_items ii
          WHERE ii."snapshotId" = ${newLatest.id} AND s.id = ii."skuId"
        `;
        await tx.$executeRaw`
          UPDATE skus SET "isActive" = false, "soldOutDetectedDate" = ${newLatest.snapshotDate}, "updatedAt" = NOW()
          WHERE "warehouseId" = ${warehouseId} AND "removedDate" IS NULL
            AND id NOT IN (SELECT "skuId" FROM inventory_items WHERE "snapshotId" = ${newLatest.id})
        `;
      } else {
        await tx.sku.updateMany({ where: { warehouseId }, data: { isActive: false } });
      }

      // 남은 스냅샷 기준으로 firstSeenDate/lastSeenDate를 다시 맞춘다. 이 창고에 데이터가 전혀
      // 남지 않은 SKU(지운 날짜가 유일한 관측이었던 경우)는 계산할 근거가 없어 건드리지 않는다
      // (isActive=false로만 남아 대시보드에서는 계속 제외된다).
      await tx.$executeRaw`
        UPDATE skus AS s SET
          "firstSeenDate" = agg.min_date,
          "lastSeenDate" = agg.max_date
        FROM (
          SELECT ii."skuId" AS sku_id, MIN(sn."snapshotDate") AS min_date, MAX(sn."snapshotDate") AS max_date
          FROM inventory_items ii
          JOIN inventory_snapshots sn ON sn.id = ii."snapshotId"
          WHERE sn."warehouseId" = ${warehouseId}
          GROUP BY ii."skuId"
        ) AS agg(sku_id, min_date, max_date)
        WHERE s.id = agg.sku_id
      `;

      return { deletedSnapshotCount: toDelete.length };
    },
    { timeout: 60000, maxWait: 15000 },
  );
  // 원본 파일 행은 스냅샷과 함께 지워졌으니, 저장소의 내용도 지운다(트랜잭션이 끝난 뒤에).
  await removeStoredFiles(fileKeys);
  return result;
}

export function listSnapshotsForWarehouse(warehouseId: string) {
  return prisma.inventorySnapshot.findMany({
    where: { warehouseId, status: 'ACTIVE' },
    orderBy: { snapshotDate: 'asc' },
    include: { uploadedBy: { select: { name: true } } },
  });
}
