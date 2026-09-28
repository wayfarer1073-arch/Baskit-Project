import { addDays, format, parseISO } from 'date-fns';
import { compareOrderUrgency, forecastNextOrder, summarizeSales } from '@/domain/segments/order-cycle';
import type { StoreDashboardData } from '@/domain/segments/read-model';
import { listDailySales, listStoreItemsWithOrders } from '@/server/repositories/store-repository';

/** 발주 예측에는 최근 1년치 매출만 있으면 충분하다(기준 기간 = 발주 기록이 쌓인 기간). */
const SALES_HISTORY_DAYS = 365;

export async function getStoreDashboard(orgId: string, asOfDate: string): Promise<StoreDashboardData> {
  const salesFrom = format(addDays(parseISO(asOfDate), -SALES_HISTORY_DAYS), 'yyyy-MM-dd');
  const [items, sales] = await Promise.all([listStoreItemsWithOrders(orgId, asOfDate), listDailySales(orgId, salesFrom)]);
  const salesUpToAsOf = sales.filter((s) => s.date <= asOfDate);
  const rows = items
    .map((item) => ({
      itemId: item.id,
      name: item.name,
      unit: item.unit,
      leadTimeDays: item.leadTimeDays,
      forecast: forecastNextOrder(item.orders, salesUpToAsOf, asOfDate, item.leadTimeDays),
    }))
    .sort((a, b) => compareOrderUrgency(a.forecast, b.forecast) || a.name.localeCompare(b.name));
  return { rows, sales: summarizeSales(salesUpToAsOf, asOfDate) };
}
