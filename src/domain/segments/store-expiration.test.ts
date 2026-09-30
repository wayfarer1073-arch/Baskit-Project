import { describe, expect, it } from 'vitest';
import { currentBatches, storeExpiration, type ExpiryOrder } from './store-expiration';

const order = (date: string, expirationDate: string | null, leftoverQuantity: number | null = null): ExpiryOrder => ({ date, quantity: 3, leftoverQuantity, expirationDate });

describe('매장 발주분 소비기한', () => {
  it('소비기한을 적지 않은 발주분은 따라가지 않는다', () => {
    expect(storeExpiration([order('2026-09-26', null)], '2026-09-30', null)).toBeNull();
    expect(storeExpiration([order('2026-09-26', '2026-10-02')], '2026-09-30', null)).toMatchObject({ date: '2026-10-02', daysLeft: 2, near: true, orderDate: '2026-09-26' });
    // 최근 발주에만 적었으면 롯트도 하나.
    expect(storeExpiration([order('2026-09-20', null), order('2026-09-26', '2026-10-08')], '2026-09-30', 3)?.lots.map((l) => l.role)).toEqual(['latest']);
  });

  it('같은 품목의 최근·직전 발주분을 두 롯트로 나누고, 가장 이른 소비기한을 앞에 둔다', () => {
    const orders = [order('2026-09-14', '2026-09-20'), order('2026-09-20', '2026-10-01'), order('2026-09-26', '2026-10-08')];
    expect(currentBatches(orders, '2026-09-30').map((o) => o.date)).toEqual(['2026-09-26', '2026-09-20']);
    const exp = storeExpiration(orders, '2026-09-30', 3)!;
    expect(exp).toMatchObject({ date: '2026-10-01', daysLeft: 1, near: true, orderDate: '2026-09-20' });
    expect(exp.lots).toEqual([
      { role: 'latest', date: '2026-10-08', daysLeft: 8, near: false, orderDate: '2026-09-26', quantity: 3 },
      { role: 'previous', date: '2026-10-01', daysLeft: 1, near: true, orderDate: '2026-09-20', quantity: 3 },
    ]);
  });

  it('최근 발주 때 잔량을 0으로 적었으면 직전 발주분은 다 쓴 것으로 보고 뺀다', () => {
    const orders = [order('2026-09-20', '2026-10-01'), order('2026-09-26', '2026-10-08', 0)];
    expect(storeExpiration(orders, '2026-09-30', 3)?.lots.map((l) => l.role)).toEqual(['latest']);
  });

  it('임박 기준보다 멀면 near가 아니고, 기준일 뒤의 발주는 보지 않는다', () => {
    const orders = [order('2026-09-26', '2026-10-20'), order('2026-10-05', '2026-10-06')];
    expect(storeExpiration(orders, '2026-09-30', 7)).toMatchObject({ date: '2026-10-20', daysLeft: 20, near: false });
    // 지난 소비기한은 음수로 남아 계속 경고한다.
    expect(storeExpiration([order('2026-09-20', '2026-09-28')], '2026-09-30', 3)).toMatchObject({ daysLeft: -2, near: true });
  });
});
