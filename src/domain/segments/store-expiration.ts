/**
 * 매장 발주분의 소비기한 따라가기.
 *
 * 소비기한은 발주마다 다를 수 있어 발주를 기록할 때(선택) 적는다. 지금 매장에 있는 것은 가장 최근 발주분이고,
 * 그 발주를 넣을 때 이전 발주분이 남아 있었다면(재발주 때 적은 잔량 > 0) 그 이전 발주분도 아직 있다고 본다.
 * 이 "지금 있는 발주분" 중 소비기한을 적은 것만 대시보드가 따라간다.
 */
export interface ExpiryOrder {
  date: string;
  quantity: number;
  leftoverQuantity: number | null;
  expirationDate: string | null;
}

export interface StoreExpiration {
  /** 가장 이른 소비기한(yyyy-MM-dd). */
  date: string;
  /** 기준일부터 남은 일수. 지났으면 음수. */
  daysLeft: number;
  /** 임박 기준 안(지난 것 포함). */
  near: boolean;
  /** 그 소비기한을 적은 발주의 날짜와 수량. */
  orderDate: string;
  quantity: number;
}

/** 매장 품목의 소비기한 임박 기준 기본값(일). 우유·빵처럼 짧게 쓰는 식재료가 많아 창고 재고(14일)보다 짧다. */
export const STORE_DEFAULT_EXPIRATION_RISK_DAYS = 3;

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00.000Z`) / 86_400_000;

/** 기준일에 매장에 있다고 보는 발주분 — 가장 최근 발주, 그리고 그때 잔량이 남아 있었다면 바로 전 발주. */
export function currentBatches<T extends ExpiryOrder>(orders: readonly T[], asOfDate: string): T[] {
  const past = orders.filter((o) => o.date <= asOfDate).sort((a, b) => a.date.localeCompare(b.date));
  const latest = past.at(-1);
  if (!latest) return [];
  const previous = past.at(-2);
  return latest.leftoverQuantity !== null && latest.leftoverQuantity > 0 && previous ? [latest, previous] : [latest];
}

/** 지금 있는 발주분 중 소비기한을 적은 것의 가장 이른 소비기한. 적은 것이 없으면 null(따라가지 않는 품목). */
export function storeExpiration(orders: readonly ExpiryOrder[], asOfDate: string, riskDays: number | null): StoreExpiration | null {
  const dated = currentBatches(orders, asOfDate).filter((o): o is ExpiryOrder & { expirationDate: string } => !!o.expirationDate);
  if (dated.length === 0) return null;
  const soonest = dated.reduce((a, b) => (b.expirationDate < a.expirationDate ? b : a));
  const daysLeft = Math.round(dayNumber(soonest.expirationDate) - dayNumber(asOfDate));
  return {
    date: soonest.expirationDate,
    daysLeft,
    near: daysLeft <= (riskDays ?? STORE_DEFAULT_EXPIRATION_RISK_DAYS),
    orderDate: soonest.date,
    quantity: soonest.quantity,
  };
}
