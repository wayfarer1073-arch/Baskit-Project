import type { BusinessSegment } from '@prisma/client';

export type Segment = BusinessSegment;
export type SegmentSlug = 'daily' | 'periodic' | 'store';

export interface NavItem {
  href: string;
  label: string;
  icon: 'dashboard' | 'calendar' | 'records' | 'board' | 'settings' | 'admin';
}

export interface SegmentMeta {
  slug: SegmentSlug;
  label: string;
  /** 누구를 위한 대시보드인지 한 줄로 — 가입 화면과 사이드바 드롭다운에 함께 쓴다. */
  audience: string;
  dashboardHref: string;
  nav: NavItem[];
}

const COMMON_TAIL: NavItem[] = [
  { href: '/board', label: '게시판', icon: 'board' },
  { href: '/settings', label: '설정', icon: 'settings' },
];

export const SEGMENT_ORDER: Segment[] = ['DAILY_SYNC', 'PERIODIC_COUNT', 'ORDER_CYCLE'];

export const SEGMENT_META: Record<Segment, SegmentMeta> = {
  DAILY_SYNC: {
    slug: 'daily',
    label: '일일 재고 연동',
    audience: '3PL·OMS에서 매일 재고 파일을 받아요',
    dashboardHref: '/dashboard/daily',
    nav: [
      { href: '/dashboard/daily', label: '대시보드', icon: 'dashboard' },
      { href: '/upload', label: '캘린더', icon: 'calendar' },
      ...COMMON_TAIL,
    ],
  },
  PERIODIC_COUNT: {
    slug: 'periodic',
    label: '비정기 실사',
    audience: '자체 창고 재고를 가끔 직접 세요',
    dashboardHref: '/dashboard/periodic',
    nav: [
      { href: '/dashboard/periodic', label: '대시보드', icon: 'dashboard' },
      { href: '/count', label: '실사 입력', icon: 'records' },
      { href: '/upload', label: '엑셀 실사', icon: 'calendar' },
      ...COMMON_TAIL,
    ],
  },
  ORDER_CYCLE: {
    slug: 'store',
    label: '매장 발주 예측',
    audience: '재고를 세기 어려워 발주 주기로 관리해요 (카페·음식점)',
    dashboardHref: '/dashboard/store',
    nav: [
      { href: '/dashboard/store', label: '대시보드', icon: 'dashboard' },
      { href: '/store/records', label: '발주·매출 기록', icon: 'records' },
      ...COMMON_TAIL,
    ],
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
