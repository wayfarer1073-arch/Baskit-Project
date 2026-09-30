/**
 * 매장 발주분의 소비기한 따라가기.
 *
 * 소비기한은 발주마다 다를 수 있어 발주를 기록할 때(선택) 적는다. 같은 품목도 발주마다 소비기한이 달라지므로
 * 가장 최근 발주분과 바로 전(직전) 발주분을 두 롯트로 나눠 따라간다. 직전 발주분은 최근 발주를 넣을 때
 * 잔량을 0으로 적었을 때만(다 쓴 것이 확실할 때만) 뺀다 — 잔량을 적지 않았으면 아직 남아 있을 수 있다고 본다.
 * 이 "지금 있는 발주분" 중 소비기한을 적은 것만 대시보드가 따라간다.
 */
export interface ExpiryOrder {
  date: string;
  quantity: number;
  leftoverQuantity: number | null;
  expirationDate: string | null;
}

/** 발주분 하나(롯트)의 소비기한. */
export interface StoreExpiryLot {
  /** 최근 발주분인지 직전 발주분인지. */
  role: 'latest' | 'previous';
  /** 소비기한(yyyy-MM-dd). */
  date: string;
  /** 기준일부터 남은 일수. 지났으면 음수. */
  daysLeft: number;
  /** 임박 기준 안(지난 것 포함). */
  near: boolean;
  /** 그 소비기한을 적은 발주의 날짜와 수량. */
  orderDate: string;
  quantity: number;
}

/** 품목의 소비기한 — 가장 이른 롯트를 앞에 펼쳐 두고(정렬·배지용), 롯트별 내역은 lots에 최근 → 직전 순으로 둔다. */
export interface StoreExpiration extends Omit<StoreExpiryLot, 'role'> {
  lots: StoreExpiryLot[];
}

/** 매장 품목의 소비기한 임박 기준 기본값(일). 우유·빵처럼 짧게 쓰는 식재료가 많아 창고 재고(14일)보다 짧다. */
export const STORE_DEFAULT_EXPIRATION_RISK_DAYS = 3;

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00.000Z`) / 86_400_000;

/** 기준일에 매장에 있다고 보는 발주분 — 가장 최근 발주, 그리고 그때 잔량을 0으로 적지 않았다면 바로 전 발주. */
export function currentBatches<T extends ExpiryOrder>(orders: readonly T[], asOfDate: string): T[] {
  const past = orders.filter((o) => o.date <= asOfDate).sort((a, b) => a.date.localeCompare(b.date));
  const latest = past.at(-1);
  if (!latest) return [];
  const previous = past.at(-2);
  return previous && latest.leftoverQuantity !== 0 ? [latest, previous] : [latest];
}

/** 지금 있는 발주분 중 소비기한을 적은 롯트들(최근 → 직전)과 가장 이른 소비기한. 적은 것이 없으면 null(따라가지 않는 품목). */
export function storeExpiration(orders: readonly ExpiryOrder[], asOfDate: string, riskDays: number | null): StoreExpiration | null {
  const limit = riskDays ?? STORE_DEFAULT_EXPIRATION_RISK_DAYS;
  const lots = currentBatches(orders, asOfDate).flatMap((o, i): StoreExpiryLot[] => {
    if (!o.expirationDate) return [];
    const daysLeft = Math.round(dayNumber(o.expirationDate) - dayNumber(asOfDate));
    return [{ role: i === 0 ? 'latest' : 'previous', date: o.expirationDate, daysLeft, near: daysLeft <= limit, orderDate: o.date, quantity: o.quantity }];
  });
  if (lots.length === 0) return null;
  const soonest = lots.reduce((a, b) => (b.date < a.date ? b : a));
  return { date: soonest.date, daysLeft: soonest.daysLeft, near: soonest.near, orderDate: soonest.orderDate, quantity: soonest.quantity, lots };
}
