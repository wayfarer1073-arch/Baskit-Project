import { describe, expect, it } from 'vitest';
import { assessReliability, type ReliabilityInput } from './reliability';

const base: ReliabilityInput = {
  source: 'SNAPSHOT',
  expectedDays: 5,
  observedDays: 5,
  windowDays: 7,
  intervals: 5,
  minIntervals: 3,
  daysSinceLevel: 0,
  halfLifeDays: 3,
  blockingReason: null,
};

describe('assessReliability', () => {
  it('rates a full recent week of file data as high', () => {
    const r = assessReliability(base);
    expect(r.score).toBe(95);
    expect(r.level).toBe('HIGH');
  });

  it('prefers a manual count over a file snapshot', () => {
    expect(assessReliability({ ...base, source: 'COUNT' }).score).toBe(100);
  });

  it('lowers the score for older basis windows and missing days', () => {
    const fortnight = assessReliability({ ...base, windowDays: 14, expectedDays: 10, observedDays: 10 });
    expect(fortnight.level).toBe('MEDIUM');
    const sparse = assessReliability({ ...base, windowDays: 14, expectedDays: 10, observedDays: 6 });
    expect(sparse.level).toBe('LOW');
    expect(sparse.notes.map((n) => n.code)).toEqual(['snapshot_source', 'sparse', 'long_window']);
    expect(assessReliability({ ...base, windowDays: 30, expectedDays: 21, observedDays: 21 }).level).toBe('LOW');
  });

  it('decays with time since the last stock check', () => {
    const periodic = { ...base, source: 'COUNT' as const, windowDays: null, halfLifeDays: 14 };
    expect(assessReliability({ ...periodic, daysSinceLevel: 3 }).level).toBe('HIGH');
    const month = assessReliability({ ...periodic, daysSinceLevel: 14 });
    expect(month.score).toBe(50);
    expect(month.notes.some((n) => n.code === 'aging')).toBe(true);
    expect(assessReliability({ ...periodic, daysSinceLevel: 28 }).level).toBe('LOW');
  });

  it('is always low when an estimate is blocked, keeping the reason first', () => {
    const r = assessReliability({ ...base, blockingReason: '자료 갱신 필요' });
    expect(r.level).toBe('LOW');
    expect(r.score).toBeLessThan(50);
    expect(r.notes[0]).toEqual({ code: 'blocked', reason: '자료 갱신 필요' });
  });

  it('penalises too few intervals', () => {
    expect(assessReliability({ ...base, intervals: 1, minIntervals: 3 }).level).toBe('LOW');
  });
});
