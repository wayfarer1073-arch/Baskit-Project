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
  it('최근 7일 자료만으로 정상 추정 가능하면 상', () => {
    const a = analyzeOperationalSku(daily(), '2026-09-19')!;
    expect(a.operating?.reason).toBeNull();
    expect(a.operating?.basisWindowDays).toBe(7);
    expect(dataReliabilityLevel(a)).toBe('HIGH');
  });

  it('근거 기간이 14일로 넓어져도 최근 4주가 촘촘히 관측됐으면 상(기간 길이로 깎지 않는다)', () => {
    // 7일 안에 업로드가 한 번뿐인 긴 연휴라 14일로 넓어지지만, 그 주도 한 구간으로 온전히 관측됐다.
    const holidays = new Set(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17']);
    const a = analyzeOperationalSku(daily(10, holidays), '2026-09-18', undefined, undefined, undefined, { holidays })!;
    expect(a.operating?.basisWindowDays).toBe(14);
    expect(dataReliabilityLevel(a)).toBe('HIGH');
  });

  it('업로드가 밀린 것(자료 갱신 필요)은 자료 신뢰도를 깎지 않고, 소진 속도를 잴 수 없는 사유가 있을 때만 하다', () => {
    const stale = analyzeOperationalSku(daily(), '2026-09-21')!;
    expect(stale.operating?.reason).toBe('자료 갱신 필요');
    expect(stale.operating?.basisWindowDays).toBe(7);
    expect(dataReliabilityLevel(stale)).toBe('HIGH');
    const special = analyzeOperationalSku(daily(), '2026-09-18', undefined, undefined, undefined, { isB2B: true })!;
    expect(dataReliabilityLevel(special)).toBe('LOW');
  });

  it('근거로 쓸 window 자체를 찾지 못하면(자료 부족) 하', () => {
    const a = analyzeOperationalSku([obs('2026-09-17', 100), obs('2026-09-18', 90)], '2026-09-18')!;
    expect(a.operating?.basisWindowDays).toBeNull();
    expect(dataReliabilityLevel(a)).toBe('LOW');
  });
});
