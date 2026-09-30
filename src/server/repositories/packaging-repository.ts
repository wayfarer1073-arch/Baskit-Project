import { prisma } from '@/lib/prisma';
import type { StockSegment } from '@/server/repositories/warehouse-repository';
import type { ParsedPackagingRow } from '@/domain/excel/packaging-types';

export interface PackagingUploadStatus {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  lastUpload: { uploadedAt: string; uploadedByName: string; sourceFileName: string; rowCount: number } | null;
}

/** 창고별 마지막 SKU 추가 정보 업로드 시각을 화면에 보여주기 위한 현황 목록. */
export async function listPackagingUploadStatus(orgId: string, segment?: StockSegment): Promise<PackagingUploadStatus[]> {
  const warehouses = await prisma.warehouse.findMany({
    where: { organizationId: orgId, isArchived: false, kind: 'STOCK', ...(segment ? { segment } : {}) },
    orderBy: { sortOrder: 'asc' },
    include: { packagingUpload: { include: { uploadedBy: { select: { name: true } } } } },
  });
  return warehouses.map((w) => ({
    warehouseId: w.id,
    warehouseCode: w.code,
    warehouseName: w.name,
    lastUpload: w.packagingUpload
      ? {
          uploadedAt: w.packagingUpload.uploadedAt.toISOString(),
          uploadedByName: w.packagingUpload.uploadedBy.name,
          sourceFileName: w.packagingUpload.sourceFileName,
          rowCount: w.packagingUpload.rowCount,
        }
      : null,
  }));
}

export interface ApplyPackagingResult {
  updatedCount: number;
  unmatchedProductCodes: string[];
}

/**
 * 파싱된 행을 해당 창고의 SKU와 상품코드로 매칭해 EA/BOX·EA/PLT·상품바코드를 반영한다. 셀이
 * 비어 있던 필드는 건드리지 않는다(부분 업데이트 — 파일 일부 컬럼만 채워도 나머지 기존 값을
 * 지우지 않기 위함). 창고에 없는 상품코드는 건너뛰고 목록으로 보고한다. 반영 여부와 무관하게
 * 업로드 자체는 항상 이력(SkuPackagingUpload)에 기록해, "언제 마지막으로 업로드했는지"는
 * 매칭 결과와 별개로 확인할 수 있게 한다.
 */
export async function applyPackagingRows(
  warehouseId: string,
  rows: ParsedPackagingRow[],
  uploadedById: string,
  sourceFileName: string,
): Promise<ApplyPackagingResult> {
  if (rows.length === 0) return { updatedCount: 0, unmatchedProductCodes: [] };

  const skus = await prisma.sku.findMany({
    where: { warehouseId, isActive: true, productCode: { in: rows.map((r) => r.productCode) } },
    select: { id: true, productCode: true },
  });
  const skuIdByCode = new Map(skus.map((s) => [s.productCode, s.id]));

  const unmatchedProductCodes = new Set<string>();
  let updatedCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const skuId = skuIdByCode.get(row.productCode);
      if (!skuId) {
        unmatchedProductCodes.add(row.productCode);
        continue;
      }
      const data: { eaPerBox?: number; eaPerPallet?: number; packagingBarcode?: string } = {};
      if (row.eaPerBox !== null) data.eaPerBox = row.eaPerBox;
      if (row.eaPerPallet !== null) data.eaPerPallet = row.eaPerPallet;
      if (row.barcode !== null) data.packagingBarcode = row.barcode;
      if (Object.keys(data).length === 0) continue;
      await tx.sku.update({ where: { id: skuId }, data });
      updatedCount += 1;
    }
    await tx.skuPackagingUpload.upsert({
      where: { warehouseId },
      create: { warehouseId, sourceFileName, rowCount: rows.length, uploadedById },
      update: { sourceFileName, rowCount: rows.length, uploadedById, uploadedAt: new Date() },
    });
  });

  return { updatedCount, unmatchedProductCodes: [...unmatchedProductCodes] };
}
