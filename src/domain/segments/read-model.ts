import type { PeriodicEstimate } from './periodic-count';
import type { OrderForecast, SalesTrend } from './order-cycle';

export interface PeriodicRow {
  skuId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  estimate: PeriodicEstimate;
}

export interface StoreForecastRow {
  itemId: string;
  name: string;
  unit: string;
  leadTimeDays: number;
  forecast: OrderForecast;
}

export interface StoreDashboardData {
  rows: StoreForecastRow[];
  sales: SalesTrend;
}

export interface OrderEntryRow {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  date: string;
  quantity: number;
  createdByName: string;
}

export interface SalesEntryRow {
  date: string;
  amount: number;
}
