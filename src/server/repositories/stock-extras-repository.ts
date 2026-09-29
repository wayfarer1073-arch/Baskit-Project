import { prisma } from '@/lib/prisma';
import type { ParsedInventoryRow } from '@/domain/excel/types';
import { syncExpirationDatesFromStockFile } from '@/server/repositories/expiration-repository';

/**
 * 재고 파일에서 함께 읽은 부가 정보를 품목에 반영한다 — 입수량·상품바코드는 값이 있는 칸만 덮어쓰고,
 * 소비기한은 이 파일이 창고의 최신 날짜일 때만 로트로 맞춘다(과거 날짜를 뒤늦게 올려 현재 로트를 되돌리지 않도록).
 */
export async function applyStockFileExtras(warehouseId: string, snapshotDate: Date, rows: ParsedInventoryRow[]): Promise<{ packagingUpdated: number; expirationSynced: number }> {
  const relevant = rows.filter((r) => r.barcode || r.eaPerBox != null || r.eaPerPallet != null || r.expirationDates?.length);
  if (relevant.length === 0) return { packagingUpdated: 0, expirationSynced: 0 };
  const skus = await prisma.sku.findMany({
    where: { warehouseId, productCode: { in: relevant.map((r) => r.productCode) } },
    select: { id: true, productCode: true, eaPerBox: true, eaPerPallet: true, packagingBarcode: true },
  });
  const byCode = new Map(skus.map((s) => [s.productCode, s]));

  let packagingUpdated = 0;
  for (const row of relevant) {
    const sku = byCode.get(row.productCode);
    if (!sku) continue;
    const data: { eaPerBox?: number; eaPerPallet?: number; packagingBarcode?: string } = {};
    if (row.eaPerBox != null && row.eaPerBox !== sku.eaPerBox) data.eaPerBox = row.eaPerBox;
    if (row.eaPerPallet != null && row.eaPerPallet !== sku.eaPerPallet) data.eaPerPallet = row.eaPerPallet;
    if (row.barcode && row.barcode !== sku.packagingBarcode) data.packagingBarcode = row.barcode;
    if (Object.keys(data).length === 0) continue;
    await prisma.sku.update({ where: { id: sku.id }, data });
    packagingUpdated++;
  }

  const latest = await prisma.inventorySnapshot.findFirst({ where: { warehouseId, status: 'ACTIVE' }, orderBy: { snapshotDate: 'desc' }, select: { snapshotDate: true } });
  let expirationSynced = 0;
  if (!latest || latest.snapshotDate.getTime() <= snapshotDate.getTime()) {
    const datesBySkuId = new Map<string, string[]>();
    for (const row of relevant) {
      const sku = byCode.get(row.productCode);
      if (sku && row.expirationDates?.length) datesBySkuId.set(sku.id, row.expirationDates);
    }
    if (datesBySkuId.size) expirationSynced = await syncExpirationDatesFromStockFile(datesBySkuId);
  }
  return { packagingUpdated, expirationSynced };
}
