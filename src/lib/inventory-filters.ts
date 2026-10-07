import type { SkuAnalysis } from '@/domain/inventory/types';
import { daysBetween } from '@/domain/inventory/shipping-calendar';

export type TableTab = 'ALL' | 'STOCKOUT_RISK' | 'ACCELERATING' | 'OVERSTOCK_CANDIDATE' | 'STAGNANT' | 'EXPIRATION_RISK';

export const TABLE_TABS: { value: TableTab; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'STOCKOUT_RISK', label: '품절 위험' },
  { value: 'ACCELERATING', label: '소진 가속' },
  { value: 'OVERSTOCK_CANDIDATE', label: '과잉 후보' },
  { value: 'STAGNANT', label: '장기 정체' },
  { value: 'EXPIRATION_RISK', label: '소비기한 임박' },
];

export function matchesTab(analysis: SkuAnalysis, tab: TableTab): boolean {
  switch (tab) {
    case 'ALL':
      return true;
    case 'STOCKOUT_RISK':
      return analysis.thresholdRisk.level === 'DANGER' || analysis.thresholdRisk.level === 'WARNING' || analysis.coverage.band === 'STOCKOUT_SOON';
    case 'ACCELERATING':
      return analysis.acceleration.trend === 'ACCELERATING';
    case 'OVERSTOCK_CANDIDATE':
      return analysis.overstock.isCandidate;
    case 'STAGNANT':
      return analysis.tags.some((t) => t.startsWith('[재고 정체'));
    case 'EXPIRATION_RISK':
      return analysis.expirationRisk.isAtRisk;
    default:
      return true;
  }
}

/** Action Center 카드 클릭 시 테이블에 적용하는 추가 narrowing 조건. tab과 함께 적용된다. */
export type QuickFilter = 'NEW_DANGER' | 'STOCKOUT_SOON_ONLY' | null;

export function matchesQuickFilter(analysis: SkuAnalysis, quickFilter: QuickFilter): boolean {
  if (!quickFilter) return true;
  if (quickFilter === 'NEW_DANGER') return analysis.tags.includes('[신규 위험]');
  if (quickFilter === 'STOCKOUT_SOON_ONLY') return analysis.coverage.band === 'STOCKOUT_SOON';
  return true;
}

/** "n일 이상 품절 숨기기" 선택지 — 0은 전체 보기. */
export const SOLD_OUT_HIDE_DAYS = [0, 7, 14, 30, 90] as const;
export type SoldOutHideDays = (typeof SOLD_OUT_HIDE_DAYS)[number];

export interface SoldOutFilter {
  /** 품절 품목을 표에 보일지(체크박스). */
  showSoldOut: boolean;
  /** 품절된 지 이만큼 이상 지난 품목은 숨긴다. 0이면 숨기지 않는다. */
  hideAfterDays: SoldOutHideDays;
}

/** 기준일까지 품절이 이어진 일수(품절 인식일 당일은 0일). 인식일을 모르면 0. */
export function soldOutDays(soldOutDetectedDate: string | null, asOfDate: string): number {
  return soldOutDetectedDate ? Math.max(0, daysBetween(soldOutDetectedDate, asOfDate)) : 0;
}

export function matchesSoldOutFilter(descriptor: { isSoldOut: boolean; soldOutDetectedDate: string | null }, filter: SoldOutFilter, asOfDate: string): boolean {
  if (!descriptor.isSoldOut) return true;
  if (!filter.showSoldOut) return false;
  return filter.hideAfterDays === 0 || soldOutDays(descriptor.soldOutDetectedDate, asOfDate) < filter.hideAfterDays;
}
