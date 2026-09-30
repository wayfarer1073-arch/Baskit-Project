import type { EventTypeValue } from '@/lib/event-types';

export interface ScheduleEventRow {
  id: string;
  skuId: string | null;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  productCode: string | null;
  productName: string | null;
  note: string;
  quantity: number | null;
}

export interface ScheduleStoreItemRow {
  storeItemId: string;
  name: string;
  unit: string;
}

export interface ScheduleRow {
  id: string;
  eventType: EventTypeValue;
  title: string;
  startDate: string;
  endDate: string;
  color: string;
  /** 캘린더 일정 패널에서 적은 상세 내용. 예전에 SKU 메모로 만든 일정은 비어 있을 수 있다. */
  note: string;
  events: ScheduleEventRow[];
  storeItems: ScheduleStoreItemRow[];
}
