import { describe, expect, it } from 'vitest';
import { dataReliabilityLevel, formatExpirationDday, humanizeTag, isB2BTag, isEstimateCaveatTag, isExpirationRiskTag, isObservedDateTag, isSoldOutTag, isStaleDepletionTag } from './status';
import { analyzeOperationalSku } from '@/domain/inventory/operational-analysis';
import { isShippingDay, shiftDate } from '@/domain/inventory/shipping-calendar';
import type { StockObservation } from '@/domain/inventory/types';

const obs = (date: string, stock: number, inbound = 0): StockObservation => ({
  date, normalStock: stock, availableStock: stock, unitCost: 10, defectiveStock: 0, incomingStock: 0, warningQty: 0, dangerQty: 0, inboundQuantity: inbound,
});
function daily(rate = 10, holidays = new Set<string>()) {
  const result: StockObservation[] = [obs('2026-09-04', 200)];
  let stock = 200;
  for (let d = '2026-09-05'; d <= '2026-09-18'; d = shiftDate(d, 1)) {
    if (isShippingDay(d, holidays)) { stock -= rate; result.push(obs(d, stock)); }
  }
  return result;
}

describe('humanizeTag', () => {
  it('물류 용어를 모르는 사용자도 이해할 수 있는 문구로 바꾼다', () => {
    expect(humanizeTag('[관측 2026-09-18]')).toBe('[2026-09-18 자료 기준]');
    expect(humanizeTag('[최근 7일 중 5출고일]')).toBe('[최근 7일 중 실제 자료 5일]');
    expect(humanizeTag('[재고 정체 12출고일]')).toBe('[12일째 재고 변화 없음]');
    expect(humanizeTag('[입고 보정 추정·반품/조정 미분리]')).toBe('[추정치 · 반품/조정 포함 가능]');
    expect(humanizeTag('[특수 관리 개별 판단]')).toBe('[특수 관리 재고 · 개별 확인 필요]');
    expect(humanizeTag('[자료 갱신 필요]')).toBe('[최근 자료 없음]');
    expect(humanizeTag('[신규 위험]')).toBe('[오늘 새로 위험 단계]');
    expect(humanizeTag('[소비기한 확인 필요]')).toBe('[소비기한 임박]');
  });

  it('알 수 없는 형태의 태그는 원문 그대로 보여준다(향후 새 태그 추가에도 화면이 깨지지 않도록)', () => {
    expect(humanizeTag('[알 수 없는 태그]')).toBe('[알 수 없는 태그]');
  });
});

describe('isObservedDateTag / isEstimateCaveatTag', () => {
  it('화면에서 걸러낼 두 고정 태그를 정확히 식별한다', () => {
    expect(isObservedDateTag('[관측 2026-09-18]')).toBe(true);
    expect(isObservedDateTag('[관측 무재고]')).toBe(false);
    expect(isEstimateCaveatTag('[입고 보정 추정·반품/조정 미분리]')).toBe(true);
    expect(isEstimateCaveatTag('[재고 정체 12출고일]')).toBe(false);
  });
});

describe('isExpirationRiskTag', () => {
  it('"[소비기한 확인 필요]" 태그만 식별한다', () => {
    expect(isExpirationRiskTag('[소비기한 확인 필요]')).toBe(true);
    expect(isExpirationRiskTag('[소비기한 임박]')).toBe(false);
  });
});

describe('formatExpirationDday', () => {
  it('남은 일수를 D-n/D-DAY/D+n(경과)으로 표시한다', () => {
    expect(formatExpirationDday(7)).toBe('D-7');
    expect(formatExpirationDday(0)).toBe('D-DAY');
    expect(formatExpirationDday(-3)).toBe('D+3');
  });
});

describe('isSoldOutTag / isStaleDepletionTag / isB2BTag', () => {
  it('상품명 옆 뱃지·정체 일수 태그와 중복되는 태그를 정확히 식별한다', () => {
    expect(isSoldOutTag('[품절]')).toBe(true);
    expect(isSoldOutTag('[관측 무재고]')).toBe(false);
    expect(isStaleDepletionTag('[소진 미관측]')).toBe(true);
    expect(isStaleDepletionTag('[재고 정체 34출고일]')).toBe(false);
    expect(isB2BTag('[특수 관리 개별 판단]')).toBe(true);
    expect(isB2BTag('[품절]')).toBe(false);
  });
});

describe('dataReliabilityLevel', () => {
  /** from부터 asOf 전날까지 출고일마다 rate씩 빠지는 긴 이력. */
  function longDaily(rate = 10, from = '2026-07-01', to = '2026-09-18') {
    const result: StockObservation[] = [obs(from, 5000)];
    let stock = 5000;
    for (let d = shiftDate(from, 1); d <= to; d = shiftDate(d, 1)) {
      if (isShippingDay(d)) { stock -= rate; result.push(obs(d, stock)); }
    }
    return result;
  }

  it('과거 자료로 1주 앞을 되짚어 맞혀 본 오차가 작으면 상', () => {
    const a = analyzeOperationalSku(longDaily(), '2026-09-18')!;
    expect(a.reliability?.horizon).toBe(5);
    expect(a.reliability?.reason).toBeNull();
    expect(dataReliabilityLevel(a)).toBe('HIGH');
  });

  it('업로드가 밀리면 밀린 기간만큼 앞을 맞혀 본 오차로 매긴다(흐름이 규칙적이면 그대로 상)', () => {
    const stale = analyzeOperationalSku(longDaily(), '2026-09-28')!;
    expect(stale.operating?.reason).toBe('자료 갱신 필요');
    expect(stale.reliability?.horizon).toBe(6);
    expect(dataReliabilityLevel(stale)).toBe('HIGH');
  });

  it('특수 관리 품목이나 자료가 짧은 품목은 하', () => {
    expect(dataReliabilityLevel(analyzeOperationalSku(longDaily(), '2026-09-18', undefined, undefined, undefined, { isB2B: true })!)).toBe('LOW');
    const short = analyzeOperationalSku(daily(), '2026-09-18')!;
    expect(short.reliability?.reason).toBe('insufficient_history');
    expect(dataReliabilityLevel(short)).toBe('LOW');
    expect(dataReliabilityLevel(analyzeOperationalSku([obs('2026-09-17', 100), obs('2026-09-18', 90)], '2026-09-18')!)).toBe('LOW');
  });
});
