import { estimatePeriodicStock } from '@/domain/segments/periodic-count';
import type { PeriodicRow } from '@/domain/segments/read-model';
import { loadActiveSkusWithSeries, loadInboundsBySku } from '@/server/repositories/inventory-repository';
import { getSettings } from '@/server/repositories/settings-repository';

/** 실사 스냅샷(업로드)마다의 정상재고를 "실사 수량"으로 보고, 마지막 실사 이후 재고를 추정한다. */
export async function getPeriodicRows(orgId: string, asOfDate: string) {
  const settings = await getSettings(orgId);
  const skus = await loadActiveSkusWithSeries(orgId, undefined, asOfDate);
  const inboundsBySku = await loadInboundsBySku(skus.map((s) => s.descriptor.skuId), asOfDate);

  const rows: PeriodicRow[] = [];
  for (const { descriptor, observations } of skus) {
    const estimate = estimatePeriodicStock(
      observations.map((o) => ({ date: o.date, quantity: o.normalStock })),
      inboundsBySku.get(descriptor.skuId) ?? [],
      asOfDate,
      { stockoutSoonDays: settings.stockoutSoonDays },
    );
    if (!estimate) continue;
    rows.push({
      skuId: descriptor.skuId,
      warehouseId: descriptor.warehouseId,
      warehouseCode: descriptor.warehouseCode,
      warehouseName: descriptor.warehouseName,
      productCode: descriptor.productCode,
      productName: descriptor.productName,
      estimate,
    });
  }
  return { rows, stockoutSoonDays: settings.stockoutSoonDays };
}
