import { estimatePeriodicStock } from '@/domain/segments/periodic-count';
import type { PeriodicRow, PeriodicSkuDetail } from '@/domain/segments/read-model';
import { loadInboundsBySku } from '@/server/repositories/inventory-repository';
import { loadCountedSkus } from '@/server/repositories/count-repository';
import { getSegmentSettings, getSettings } from '@/server/repositories/settings-repository';

async function loadOptions(orgId: string) {
  const [settings, { periodicRecountDays }] = await Promise.all([getSettings(orgId), getSegmentSettings(orgId)]);
  return { stockoutSoonDays: settings.stockoutSoonDays, recountDays: periodicRecountDays };
}

/** 상품마다 자기 실사 이력(엑셀 업로드·직접 입력)으로 마지막 실사 이후 재고를 추정한다. */
export async function getPeriodicRows(orgId: string, asOfDate: string) {
  const [options, skus] = await Promise.all([loadOptions(orgId), loadCountedSkus(orgId, asOfDate)]);
  const inboundsBySku = await loadInboundsBySku(
    skus.map((s) => s.descriptor.skuId),
    asOfDate,
  );

  const rows: PeriodicRow[] = [];
  for (const { descriptor, counts } of skus) {
    const estimate = estimatePeriodicStock(counts, inboundsBySku.get(descriptor.skuId) ?? [], asOfDate, options);
    if (estimate) rows.push({ ...descriptor, estimate });
  }
  return { rows, ...options };
}

export async function getPeriodicSkuDetail(orgId: string, skuId: string, asOfDate: string): Promise<PeriodicSkuDetail | null> {
  const [options, [sku]] = await Promise.all([loadOptions(orgId), loadCountedSkus(orgId, asOfDate, skuId)]);
  if (!sku) return null;
  const inbounds = (await loadInboundsBySku([skuId], asOfDate)).get(skuId) ?? [];
  const estimate = estimatePeriodicStock(sku.counts, inbounds, asOfDate, options);
  if (!estimate) return null;
  return {
    ...sku.descriptor,
    estimate,
    unitCost: sku.unitCost,
    counts: [...sku.counts].reverse(),
    inbounds: inbounds.map((i) => ({ date: i.date, quantity: i.quantity })).reverse(),
    ...options,
  };
}
