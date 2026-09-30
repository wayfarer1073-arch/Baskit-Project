import type { BusinessSegment } from '@prisma/client';

export type Segment = BusinessSegment;
export type SegmentSlug = 'daily' | 'periodic' | 'store';

export interface SegmentMeta {
  slug: SegmentSlug;
  label: string;
  /** 누구를 위한 대시보드인지 한 줄로 — 가입 화면과 사이드바 드롭다운에 함께 쓴다. */
  audience: string;
  dashboardHref: string;
}

/** 캘린더는 모든 방식이 함께 쓴다 — 날짜를 누르면 방식별 업로드·입력 패널이 열린다. 사이드바 맨 위·로고 링크. */
export const CALENDAR_HREF = '/upload';

export const SEGMENT_ORDER: Segment[] = ['DAILY_SYNC', 'PERIODIC_COUNT', 'ORDER_CYCLE'];

export const SEGMENT_META: Record<Segment, SegmentMeta> = {
  DAILY_SYNC: {
    slug: 'daily',
    label: '일일 재고 연동',
    audience: '3PL·OMS에서 매일 재고 파일을 받아요',
    dashboardHref: '/dashboard/daily',
  },
  PERIODIC_COUNT: {
    slug: 'periodic',
    label: '비정기 실사',
    audience: '자체 창고 재고를 가끔 직접 세요',
    dashboardHref: '/dashboard/periodic',
  },
  ORDER_CYCLE: {
    slug: 'store',
    label: '매장 발주 예측',
    audience: '재고를 세기 어려워 발주 주기로 관리해요 (카페·음식점)',
    dashboardHref: '/dashboard/store',
  },
};

/** 사이드바 드롭다운에서 고른 대시보드를 기억하는 쿠키. 없으면 워크스페이스 가입 시 고른 방식을 쓴다. */
export const SEGMENT_COOKIE = 'limenote_segment';

export function isSegment(value: unknown): value is Segment {
  return typeof value === 'string' && (SEGMENT_ORDER as string[]).includes(value);
}

export function segmentForPath(pathname: string): Segment | null {
  for (const segment of SEGMENT_ORDER) {
    const meta = SEGMENT_META[segment];
    if (pathname === meta.dashboardHref || pathname.startsWith(`${meta.dashboardHref}/`)) return segment;
  }
  if (pathname.startsWith('/store/')) return 'ORDER_CYCLE';
  if (pathname === '/count') return 'PERIODIC_COUNT';
  return null;
}

/** 설정에서 끈 방식을 뺀, 이 워크스페이스가 쓰는 방식들(순서 고정). 모두 꺼져 있으면 기본 방식 하나는 남긴다. */
export function enabledSegmentsOf(disabled: readonly Segment[], fallback: Segment): Segment[] {
  const enabled = SEGMENT_ORDER.filter((s) => !disabled.includes(s));
  return enabled.length > 0 ? enabled : [fallback];
}

/** 원하는 방식(쿠키·경로)이 꺼져 있으면 기본 방식, 그것도 꺼져 있으면 쓰는 방식 중 첫 번째로. */
export function resolveSegment(wanted: Segment | null | undefined, enabled: readonly Segment[], orgDefault: Segment): Segment {
  if (wanted && enabled.includes(wanted)) return wanted;
  if (enabled.includes(orgDefault)) return orgDefault;
  return enabled[0] ?? orgDefault;
}
