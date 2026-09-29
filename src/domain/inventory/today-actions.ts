import type { InventoryRow } from './read-model';

/**
 * 홈 화면 "오늘 조치할 것" — 그래프보다 먼저, 사람이 오늘 해야 할 일을 급한 순서로 한 줄씩.
 *  1. 발주가 늦었거나 오늘 발주해야 하는 품목(도착 전 품절이면 더 앞)
 *  2. 자료를 확인해야 하는 품목(갱신 누락·수치 이상·설명 안 된 증가) — 틀린 자료로 발주하지 않도록
 *  3. 이번 주 안에 발주할 품목
 *  4. 소비기한 확인
 *  5. 정리 검토(장기 정체·과잉)
 */
export type TodayActionKind = 'order_now' | 'check_data' | 'order_soon' | 'expiration' | 'reduce';

export interface TodayAction {
  kind: TodayActionKind;
  skuId: string;
  productCode: string;
  productName: string;
  warehouseName: string;
  /** 정렬용 — 작을수록 급하다. */
  priority: number;
  orderDate?: string | null;
  quantity?: number;
  stockoutBeforeArrival?: boolean;
  overdueDays?: number;
  reason?: string;
  daysUntilExpiration?: number | null;
  stagnantDays?: number;
  overstock?: boolean;
  supplierName?: string | null;
}

const DATA_REASONS = new Set(['자료 갱신 필요', '재고 정합성 확인', '입고·조정 확인']);

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function buildTodayActions(rows: InventoryRow[], asOfDate: string, stagnantDaysThreshold: number): TodayAction[] {
  const actions: TodayAction[] = [];
  for (const row of rows) {
    const d = row.descriptor;
    const a = row.analysis;
    if (d.isSoldOut) continue;
    const base = { skuId: d.skuId, productCode: d.productCode, productName: d.productName, warehouseName: d.warehouseName, supplierName: d.supplierName ?? null };
    const r = row.reorder;
    const reason = a.operating?.reason ?? null;

    if (reason && DATA_REASONS.has(reason)) {
      actions.push({ ...base, kind: 'check_data', priority: 200, reason });
    } else if (r && (r.status === 'overdue' || r.status === 'today')) {
      const stockoutBeforeArrival = r.stockAtArrival <= 0;
      const overdueDays = r.orderDate ? Math.max(0, daysBetween(r.orderDate, asOfDate)) : 0;
      actions.push({
        ...base,
        kind: 'order_now',
        priority: (stockoutBeforeArrival ? 0 : 100) - Math.min(overdueDays, 99),
        orderDate: r.orderDate,
        quantity: r.quantity,
        stockoutBeforeArrival,
        overdueDays,
      });
    } else if (r && r.status === 'soon' && r.orderDate) {
      actions.push({ ...base, kind: 'order_soon', priority: 300 + daysBetween(asOfDate, r.orderDate), orderDate: r.orderDate, quantity: r.quantity });
    }

    if (a.expirationRisk.isAtRisk) {
      actions.push({
        ...base,
        kind: 'expiration',
        priority: 400 + Math.max(0, a.expirationRisk.daysUntilExpiration ?? 0),
        daysUntilExpiration: a.expirationRisk.daysUntilExpiration,
      });
    }
    const stagnant = a.stagnation.isMeaningful && a.stagnation.stagnantDays >= stagnantDaysThreshold;
    if (stagnant || a.overstock.isCandidate) {
      actions.push({
        ...base,
        kind: 'reduce',
        priority: 500 - Math.min(row.valueBreakdown.normalStockValue / 1_000_000, 99),
        stagnantDays: stagnant ? a.stagnation.stagnantDays : undefined,
        overstock: a.overstock.isCandidate,
      });
    }
  }
  return actions.sort((x, y) => x.priority - y.priority || x.productName.localeCompare(y.productName));
}
