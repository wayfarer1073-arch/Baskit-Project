import type { Segment } from '@/lib/segments';

export type SettingsTab = 'common' | 'daily' | 'periodic' | 'store';

export const SEGMENT_TAB: Record<Segment, SettingsTab> = { DAILY_SYNC: 'daily', PERIODIC_COUNT: 'periodic', ORDER_CYCLE: 'store' };

export function isSettingsTab(value: unknown): value is SettingsTab {
  return value === 'common' || value === 'daily' || value === 'periodic' || value === 'store';
}
