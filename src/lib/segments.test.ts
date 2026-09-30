import { describe, expect, it } from 'vitest';
import { enabledSegmentsOf, resolveSegment, segmentForPath } from './segments';

describe('enabledSegmentsOf', () => {
  it('끈 방식을 빼고 고정 순서로 돌려준다', () => {
    expect(enabledSegmentsOf([], 'DAILY_SYNC')).toEqual(['DAILY_SYNC', 'PERIODIC_COUNT', 'ORDER_CYCLE']);
    expect(enabledSegmentsOf(['PERIODIC_COUNT'], 'DAILY_SYNC')).toEqual(['DAILY_SYNC', 'ORDER_CYCLE']);
  });

  it('모두 꺼져 있으면 기본 방식 하나는 남긴다', () => {
    expect(enabledSegmentsOf(['DAILY_SYNC', 'PERIODIC_COUNT', 'ORDER_CYCLE'], 'ORDER_CYCLE')).toEqual(['ORDER_CYCLE']);
  });
});

describe('resolveSegment', () => {
  const enabled = ['PERIODIC_COUNT', 'ORDER_CYCLE'] as const;
  it('원하는 방식이 켜져 있으면 그대로', () => {
    expect(resolveSegment('ORDER_CYCLE', enabled, 'DAILY_SYNC')).toBe('ORDER_CYCLE');
  });
  it('꺼진 방식이면 기본 방식, 그것도 꺼져 있으면 첫 번째', () => {
    expect(resolveSegment('DAILY_SYNC', enabled, 'ORDER_CYCLE')).toBe('ORDER_CYCLE');
    expect(resolveSegment('DAILY_SYNC', enabled, 'DAILY_SYNC')).toBe('PERIODIC_COUNT');
    expect(resolveSegment(null, enabled, 'DAILY_SYNC')).toBe('PERIODIC_COUNT');
  });
});

describe('segmentForPath', () => {
  it('대시보드 경로에서만 방식을 정한다', () => {
    expect(segmentForPath('/dashboard/store')).toBe('ORDER_CYCLE');
    expect(segmentForPath('/upload')).toBeNull();
  });
});
