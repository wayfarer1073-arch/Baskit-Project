import { daysBetween, isDemandDay, latestShippingDay, NO_HOLIDAYS, shiftDate, type ClosedDays } from '@/domain/inventory/shipping-calendar';

/**
 * 권장 발주일·발주량.
 *
 * 발주 기준은 세 층으로 정한다 — 품목 예외 > 거래처 기본값 > 워크스페이스 기본값. 비어 있는 칸은 아래 층 값을 쓴다.
 *  - 리드타임: 발주하고 받기까지 걸리는 달력 일수
 *  - 안전재고일: 도착했을 때 최소한 남아 있어야 하는 재고(소진 속도 × 일수)
 *  - 목표 재고일수: 한 번 발주로 버틸 기간(다음 발주까지의 간격)
 *  - 최소발주량, 발주 단위(박스 입수 등으로 올림)
 *
 * 소진 속도는 수요일(주말 제외, 휴무일 포함) 기준이므로 재고 추이도 같은 달력으로 앞으로 굴려 본다.
 */
export interface PolicyLayer {
  leadTimeDays?: number | null;
  safetyDays?: number | null;
  targetDays?: number | null;
  minOrderQty?: number | null;
  orderMultiple?: number | null;
}

export const POLICY_KEYS = ['leadTimeDays', 'safetyDays', 'targetDays', 'minOrderQty', 'orderMultiple'] as const;
export type PolicyKey = (typeof POLICY_KEYS)[number];
export type PolicySource = 'item' | 'supplier' | 'default';

export interface ReorderPolicy {
  leadTimeDays: number;
  safetyDays: number;
  targetDays: number;
  minOrderQty: number;
  orderMultiple: number;
  sources: Record<PolicyKey, PolicySource>;
}

export const DEFAULT_REORDER_POLICY: Required<{ [K in PolicyKey]: number }> = { leadTimeDays: 3, safetyDays: 3, targetDays: 14, minOrderQty: 0, orderMultiple: 1 };

export function resolvePolicy(defaults: { [K in PolicyKey]: number }, supplier?: PolicyLayer | null, item?: PolicyLayer | null): ReorderPolicy {
  const out = { sources: {} } as ReorderPolicy;
  for (const key of POLICY_KEYS) {
    const fromItem = item?.[key];
    const fromSupplier = supplier?.[key];
    if (fromItem !== null && fromItem !== undefined) {
      out[key] = fromItem;
      out.sources[key] = 'item';
    } else if (fromSupplier !== null && fromSupplier !== undefined) {
      out[key] = fromSupplier;
      out.sources[key] = 'supplier';
    } else {
      out[key] = defaults[key];
      out.sources[key] = 'default';
    }
  }
  return out;
}

/** 설정 화면의 거래처별 발주 기준 행. */
export interface SupplierPolicyRow {
  id: string;
  name: string;
  leadTimeDays: number;
  safetyDays: number | null;
  targetDays: number | null;
  minOrderQty: number | null;
  orderMultiple: number | null;
  /** 일일 재고 연동 품목 중 이 거래처에 연결된 수. */
  skuCount: number;
}

export type ReorderStatus = 'overdue' | 'today' | 'soon' | 'later' | 'not_needed';

export interface ReorderSuggestion {
  /** 발주해야 하는 날(이미 지났으면 지난 날짜). 2년 안에 필요 없으면 null. */
  orderDate: string | null;
  status: ReorderStatus;
  /** 기준일 기준으로 오늘 발주하면 받는 날. */
  arrivalDate: string | null;
  /** 권장 발주량(최소발주량·발주 단위 반영). */
  quantity: number;
  /** 도착할 때 남아 있을 것으로 보는 재고. 0이면 도착 전에 품절. */
  stockAtArrival: number;
  policy: ReorderPolicy;
}

const SOON_DAYS = 7;
const HORIZON_DAYS = 730;

function roundOrder(qty: number, policy: ReorderPolicy): number {
  if (qty <= 0) return 0;
  const multiple = Math.max(1, policy.orderMultiple);
  const atLeast = Math.max(qty, policy.minOrderQty);
  return Math.ceil(atLeast / multiple) * multiple;
}

/**
 * @param stock 마지막 관측 재고
 * @param rate 수요일당 소진 속도(없거나 0이면 제안하지 않음)
 * @param observedDate 마지막 관측일
 */
export function suggestReorder(input: {
  stock: number;
  rate: number | null;
  observedDate: string;
  asOfDate: string;
  policy: ReorderPolicy;
  calendar?: ClosedDays;
}): ReorderSuggestion | null {
  const { rate, policy } = input;
  if (rate === null || !(rate > 0)) return null;
  const calendar = input.calendar ?? NO_HOLIDAYS;
  const start = input.observedDate;
  // (관측일, 관측일 + k] 의 수요일 수를 한 번씩만 센다 — 후보일마다 달력을 처음부터 다시 세면 품목 수백 개에서 수십 초가 걸린다.
  const cumulative = [0];
  const demandDaysUntil = (date: string) => {
    const k = daysBetween(start, date);
    if (k <= 0) return 0;
    for (let offset = cumulative.length; offset <= k; offset++) cumulative.push(cumulative[offset - 1] + (isDemandDay(shiftDate(start, offset), calendar) ? 1 : 0));
    return cumulative[k];
  };
  const stockAt = (date: string) => input.stock - rate * demandDaysUntil(date);
  const safetyStock = rate * policy.safetyDays;
  const arrivalOf = (d: string) => shiftDate(d, policy.leadTimeDays);

  // 이 날 발주하면 도착 때 재고가 안전재고 아래로 떨어지는 첫 날 = 늦어도 이날 발주해야 한다.
  let orderDate: string | null = null;
  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const d = shiftDate(start, i);
    if (stockAt(arrivalOf(d)) <= safetyStock) {
      // 주말·휴무일에는 발주하지 않으므로 그 전 영업일로 당긴다.
      orderDate = latestShippingDay(d, calendar);
      break;
    }
  }

  // 발주량은 '지금(기준일) 또는 권장 발주일 중 늦은 날'에 발주한다고 보고 계산한다.
  const orderOn = orderDate && orderDate > input.asOfDate ? orderDate : input.asOfDate;
  const arrivalDate = arrivalOf(orderOn);
  const stockAtArrival = Math.max(0, stockAt(arrivalDate));
  const quantity = orderDate ? roundOrder(rate * (policy.targetDays + policy.safetyDays) - stockAtArrival, policy) : 0;

  let status: ReorderStatus;
  if (!orderDate) status = 'not_needed';
  else {
    const days = daysBetween(input.asOfDate, orderDate);
    status = days < 0 ? 'overdue' : days === 0 ? 'today' : days <= SOON_DAYS ? 'soon' : 'later';
  }
  return { orderDate, status, arrivalDate: orderDate ? arrivalDate : null, quantity, stockAtArrival: Math.round(stockAtArrival), policy };
}

/** 기간 회전율 — 기간 소진량 ÷ 평균 재고. 평균 재고가 0이면 계산하지 않는다. */
export function turnover(depletion: number, averageStock: number): number | null {
  return averageStock > 0 ? depletion / averageStock : null;
}
