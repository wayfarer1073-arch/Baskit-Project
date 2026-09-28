import { addDays, format, parseISO } from 'date-fns';
import { analyzeCoverage, compareCoverageUrgency, summarizeSales, type CoverageOptions } from '@/domain/segments/sales-coverage';
import type { StoreDashboardData, StoreItemDetail, StoreItemLearning } from '@/domain/segments/read-model';
import { getSegmentSettings } from '@/server/repositories/settings-repository';
import { listDailySales, listRecentOrders, listStoreItemsWithOrders } from '@/server/repositories/store-repository';

/** 학습(발주 사이 매출)과 최근 평균 매출에는 최근 1년치 매출이면 충분하다. */
const SALES_HISTORY_DAYS = 365;

async function loadSales(orgId: string, asOfDate: string) {
  const from = format(addDays(parseISO(asOfDate), -SALES_HISTORY_DAYS), 'yyyy-MM-dd');
  return (await listDailySales(orgId, from)).filter((s) => s.date <= asOfDate);
}

async function loadOptions(orgId: string): Promise<CoverageOptions & { checkRemainingPct: number }> {
  const { storeCheckRemainingPct } = await getSegmentSettings(orgId);
  return { checkRemainingRatio: storeCheckRemainingPct / 100, checkRemainingPct: storeCheckRemainingPct };
}

export async function getStoreDashboard(orgId: string, asOfDate: string): Promise<StoreDashboardData> {
  const [items, sales, options] = await Promise.all([listStoreItemsWithOrders(orgId, asOfDate), loadSales(orgId, asOfDate), loadOptions(orgId)]);
  const rows = items
    .map((item) => ({
      itemId: item.id,
      name: item.name,
      unit: item.unit,
      leadTimeDays: item.leadTimeDays,
      supplierName: item.supplierName,
      analysis: analyzeCoverage(item.orders, sales, asOfDate, item.leadTimeDays, options),
    }))
    .sort((a, b) => compareCoverageUrgency(a.analysis, b.analysis) || a.name.localeCompare(b.name));
  return { rows, sales: summarizeSales(sales, asOfDate), lastSalesDate: sales.at(-1)?.date ?? null, checkRemainingPct: options.checkRemainingPct };
}

export async function getStoreItemDetail(orgId: string, itemId: string, asOfDate: string): Promise<StoreItemDetail | null> {
  const [items, sales, options] = await Promise.all([listStoreItemsWithOrders(orgId, asOfDate), loadSales(orgId, asOfDate), loadOptions(orgId)]);
  const item = items.find((i) => i.id === itemId);
  if (!item) return null;
  const orders = await listRecentOrders(orgId, 100, itemId);
  return {
    itemId: item.id,
    name: item.name,
    unit: item.unit,
    leadTimeDays: item.leadTimeDays,
    supplierName: item.supplierName,
    analysis: analyzeCoverage(item.orders, sales, asOfDate, item.leadTimeDays, options),
    orders,
    checkRemainingPct: options.checkRemainingPct,
  };
}

export async function getStoreItemLearning(orgId: string, asOfDate: string): Promise<StoreItemLearning[]> {
  const [items, sales, options] = await Promise.all([listStoreItemsWithOrders(orgId, asOfDate), loadSales(orgId, asOfDate), loadOptions(orgId)]);
  return items.map((i) => {
    const a = analyzeCoverage(i.orders, sales, asOfDate, i.leadTimeDays, options);
    return {
      id: i.id,
      name: i.name,
      unit: i.unit,
      leadTimeDays: i.leadTimeDays,
      itemLeadTimeDays: i.itemLeadTimeDays,
      supplierId: i.supplierId,
      supplierName: i.supplierName,
      estimatedRemainingUnits: a.estimatedRemainingUnits,
      orderCount: i.orders.length,
      salesPerUnit: a.salesPerUnit,
      learnedCycles: a.learnedCycles,
    };
  });
}
