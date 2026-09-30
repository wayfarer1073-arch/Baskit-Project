import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { PeriodicStatus } from './periodic-count';
import type { PeriodicRow } from './read-model';
import type { SalesRecord } from './sales-coverage';

/**
 * 대시보드 '기간 비교' — 시작일과 종료일(둘 다 포함) 사이의 변화를 모드별로 정리한다.
 * 화면의 나머지 부분은 종료일 기준 현재 상태를 보여 주고, 이 요약이 그 기간에 무엇이 바뀌었는지 알려 준다.
 */

const shift = (date: string, days: number) => format(addDays(parseISO(date), days), 'yyyy-MM-dd');

/** 시작·종료일을 포함한 일수. */
export const rangeDays = (from: string, to: string) => differenceInCalendarDays(parseISO(to), parseISO(from)) + 1;

// ── 비정기 실사 ─────────────────────────────────────────────────────────────────────────────

export interface PeriodicRangeRow {
  skuId: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  /** 시작일 기준 추정 재고. 시작일에 아직 실사 기록이 없었으면 null. */
  fromStock: number | null;
  toStock: number | null;
  /** 종료 − 시작. 어느 한쪽을 모르면 null. */
  change: number | null;
  fromStatus: PeriodicStatus | null;
  toStatus: PeriodicStatus;
  /** 기간 안(시작일 다음 날 ~ 종료일)에 새로 실사했는지. */
  countedInRange: boolean;
}

export interface PeriodicRangeSummary {
  from: string;
  to: string;
  days: number;
  rows: PeriodicRangeRow[];
  /** 두 날짜 모두 추정 재고를 아는 SKU만 더한 합계 — 서로 비교할 수 있도록 같은 SKU끼리만 센다. */
  fromStock: number;
  toStock: number;
  countedSkus: number;
  /** 기간 중 새로 '추정 품절'이 된 SKU. */
  newlyOut: number;
  /** 시작일엔 추정 품절이었다가 종료일엔 아닌 SKU(실사·입고로 회복). */
  recovered: number;
}

export function comparePeriodicRange(fromRows: PeriodicRow[], toRows: PeriodicRow[], from: string, to: string): PeriodicRangeSummary {
  const fromBySku = new Map(fromRows.map((r) => [r.skuId, r]));
  let fromStock = 0;
  let toStock = 0;
  let countedSkus = 0;
  let newlyOut = 0;
  let recovered = 0;
  const rows = toRows.map((r): PeriodicRangeRow => {
    const before = fromBySku.get(r.skuId) ?? null;
    const start = before?.estimate.estimatedStock ?? null;
    const end = r.estimate.estimatedStock;
    const change = start !== null && end !== null ? end - start : null;
    if (change !== null) {
      fromStock += start!;
      toStock += end!;
    }
    const countedInRange = r.estimate.lastCountDate > from && r.estimate.lastCountDate <= to;
    if (countedInRange) countedSkus++;
    const wasOut = before?.estimate.status === 'estimated_out';
    const isOut = r.estimate.status === 'estimated_out';
    if (isOut && !wasOut) newlyOut++;
    if (wasOut && !isOut) recovered++;
    return {
      skuId: r.skuId,
      warehouseName: r.warehouseName,
      productCode: r.productCode,
      productName: r.productName,
      fromStock: start,
      toStock: end,
      change,
      fromStatus: before?.estimate.status ?? null,
      toStatus: r.estimate.status,
      countedInRange,
    };
  });
  // 많이 변한 품목부터. 변화를 모르는 품목(기간 중 처음 센 품목 등)은 뒤로.
  rows.sort((a, b) => {
    if ((a.change === null) !== (b.change === null)) return a.change === null ? 1 : -1;
    return Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0) || a.productName.localeCompare(b.productName);
  });
  return { from, to, days: rangeDays(from, to), rows, fromStock, toStock, countedSkus, newlyOut, recovered };
}

// ── 매장 발주 예측 ──────────────────────────────────────────────────────────────────────────

export interface StoreRangeItemInput {
  id: string;
  name: string;
  unit: string;
  orders: { date: string; quantity: number }[];
}

export interface StoreRangeItem {
  itemId: string;
  name: string;
  unit: string;
  orderCount: number;
  quantity: number;
}

export interface StoreRangeSummary {
  from: string;
  to: string;
  days: number;
  salesTotal: number;
  /** 기간 중 매출을 입력한 날 수. */
  salesDays: number;
  /** 입력한 날 기준 하루 평균 매출. 입력한 날이 없으면 null. */
  dailyAverage: number | null;
  previous: { from: string; to: string; salesTotal: number; salesDays: number; dailyAverage: number | null };
  /** 직전 같은 길이 기간 대비 하루 평균 매출 변화율(%). 비교할 수 없으면 null. */
  changePct: number | null;
  orderCount: number;
  items: StoreRangeItem[];
}

function salesIn(sales: SalesRecord[], from: string, to: string) {
  const inRange = sales.filter((s) => s.date >= from && s.date <= to);
  const total = inRange.reduce((sum, s) => sum + s.amount, 0);
  return { salesTotal: total, salesDays: inRange.length, dailyAverage: inRange.length ? total / inRange.length : null };
}

export function compareStoreRange(items: StoreRangeItemInput[], sales: SalesRecord[], from: string, to: string): StoreRangeSummary {
  const days = rangeDays(from, to);
  const current = salesIn(sales, from, to);
  const prevTo = shift(from, -1);
  const prevFrom = shift(from, -days);
  const previous = { from: prevFrom, to: prevTo, ...salesIn(sales, prevFrom, prevTo) };
  const changePct =
    current.dailyAverage !== null && previous.dailyAverage !== null && previous.dailyAverage > 0
      ? ((current.dailyAverage - previous.dailyAverage) / previous.dailyAverage) * 100
      : null;
  const rangeItems = items
    .map((item) => {
      const orders = item.orders.filter((o) => o.date >= from && o.date <= to);
      return { itemId: item.id, name: item.name, unit: item.unit, orderCount: orders.length, quantity: orders.reduce((sum, o) => sum + o.quantity, 0) };
    })
    .filter((i) => i.orderCount > 0)
    .sort((a, b) => b.orderCount - a.orderCount || b.quantity - a.quantity || a.name.localeCompare(b.name));
  return { from, to, days, ...current, previous, changePct, orderCount: rangeItems.reduce((sum, i) => sum + i.orderCount, 0), items: rangeItems };
}
