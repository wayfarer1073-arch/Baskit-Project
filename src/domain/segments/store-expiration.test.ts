import { describe, expect, it } from 'vitest';
import { currentBatches, storeExpiration, type ExpiryOrder } from './store-expiration';

const order = (date: string, expirationDate: string | null, leftoverQuantity: number | null = null): ExpiryOrder => ({ date, quantity: 3, leftoverQuantity, expirationDate });

describe('매장 발주분 소비기한', () => {
  it('가장 최근 발주분만 지금 있다고 보고, 소비기한을 적지 않았으면 따라가지 않는다', () => {
    expect(storeExpiration([order('2026-09-20', '2026-09-25'), order('2026-09-26', null)], '2026-09-30', null)).toBeNull();
    expect(storeExpiration([order('2026-09-26', '2026-10-02')], '2026-09-30', null)).toMatchObject({ date: '2026-10-02', daysLeft: 2, near: true, orderDate: '2026-09-26' });
  });

  it('재발주 때 잔량이 남아 있었으면 이전 발주분의 소비기한도 함께 본다(더 이른 쪽)', () => {
    const orders = [order('2026-09-20', '2026-10-01'), order('2026-09-26', '2026-10-08', 0.5)];
    expect(currentBatches(orders, '2026-09-30').map((o) => o.date)).toEqual(['2026-09-26', '2026-09-20']);
    expect(storeExpiration(orders, '2026-09-30', 3)).toMatchObject({ date: '2026-10-01', daysLeft: 1, near: true, orderDate: '2026-09-20' });
  });

  it('임박 기준보다 멀면 near가 아니고, 기준일 뒤의 발주는 보지 않는다', () => {
    const orders = [order('2026-09-26', '2026-10-20'), order('2026-10-05', '2026-10-06')];
    expect(storeExpiration(orders, '2026-09-30', 7)).toMatchObject({ date: '2026-10-20', daysLeft: 20, near: false });
    // 지난 소비기한은 음수로 남아 계속 경고한다.
    expect(storeExpiration([order('2026-09-20', '2026-09-28')], '2026-09-30', 3)).toMatchObject({ daysLeft: -2, near: true });
  });
});
