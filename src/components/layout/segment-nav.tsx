'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, ChefHat, LayoutDashboard, MessagesSquare, NotebookPen, Settings, ShieldCheck } from 'lucide-react';
import { CALENDAR_HREF, SEGMENT_COOKIE, SEGMENT_META, segmentForPath, type Segment } from '@/lib/segments';
import { postTagDotClassName, type PostTagValue } from '@/lib/post-tags';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n/i18n-provider';

function writeSegmentCookie(segment: Segment) {
  document.cookie = `${SEGMENT_COOKIE}=${segment}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

/**
 * 대시보드 경로에 있으면 그 경로의 방식을, 공용 화면(캘린더·게시판·설정 등)에서는 마지막으로 본 방식을
 * 현재 방식으로 본다. 대시보드 URL로 바로 들어온 경우에도 쿠키를 맞춰서 다음 방문에도 이어지게 한다.
 */
export function useActiveSegment(fallback: Segment, enabled: readonly Segment[]): Segment {
  const pathname = usePathname();
  const candidate = segmentForPath(pathname);
  const fromPath = candidate && enabled.includes(candidate) ? candidate : null;
  // 레이아웃은 화면을 옮겨도 다시 그려지지 않으므로, 서버가 준 기본값 대신 마지막으로 본 대시보드를 기억한다.
  const [last, setLast] = useState(fallback);
  if (fromPath && fromPath !== last) setLast(fromPath);
  useEffect(() => {
    if (fromPath) writeSegmentCookie(fromPath);
  }, [fromPath]);
  return fromPath ?? (enabled.includes(last) ? last : fallback);
}

export interface NavRecentPost {
  id: string;
  tag: PostTagValue;
  title: string;
}

interface AppNavProps {
  segment: Segment;
  /** 설정에서 켜 둔 대시보드 유형 — 대시보드 아래 하위 메뉴로 보인다. */
  enabled: readonly Segment[];
  variant: 'sidebar' | 'drawer';
  recentPosts?: NavRecentPost[];
  isPlatformAdmin?: boolean;
  onNavigate?: () => void;
}

const EASY_COUNT_HREF = '/dashboard/store/easy-count';
const MENUS_HREF = '/dashboard/store/menus';

const ICONS = { calendar: CalendarDays, dashboard: LayoutDashboard, board: MessagesSquare, settings: Settings, admin: ShieldCheck };

/** 사이드바·모바일 메뉴 공용: 캘린더 / 대시보드(유형별 하위 메뉴) / 게시판(유형별 최근 글) / 설정 / 운영자 콘솔. */
export function AppNav({ segment, enabled, variant, recentPosts, isPlatformAdmin, onNavigate }: AppNavProps) {
  const pathname = usePathname();
  const { m } = useI18n();
  const dark = variant === 'sidebar';
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const itemClass = (active: boolean) =>
    cn(
      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
      active
        ? 'bg-brand-accent text-brand-accent-foreground'
        : dark
          ? 'text-sidebar-muted-foreground hover:bg-sidebar-hover-bg hover:text-sidebar-foreground'
          : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
    );
  const subClass = (active: boolean) =>
    cn(
      'flex items-center gap-2 rounded-lg py-1.5 pr-3 pl-10 text-xs transition-colors',
      active
        ? dark
          ? 'font-semibold text-brand-accent'
          : 'font-semibold text-foreground'
        : dark
          ? 'text-sidebar-muted-foreground hover:bg-sidebar-hover-bg hover:text-sidebar-foreground'
          : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
    );

  function item(href: string, icon: keyof typeof ICONS, label: string, active: boolean) {
    const Icon = ICONS[icon];
    return (
      <Link href={href} onClick={onNavigate} className={itemClass(active)} aria-current={active ? 'page' : undefined}>
        <Icon className="size-[18px]" aria-hidden="true" />
        {label}
      </Link>
    );
  }

  const onDashboard = pathname.startsWith('/dashboard');
  const onEasyCount = isActive(EASY_COUNT_HREF);
  const onMenus = isActive(MENUS_HREF);
  const onStoreSub = onEasyCount || onMenus;
  return (
    <>
      {item(CALENDAR_HREF, 'calendar', m.nav.items.calendar, isActive(CALENDAR_HREF))}

      <div>
        {item(SEGMENT_META[segment].dashboardHref, 'dashboard', m.nav.items.dashboard, onDashboard)}
        <div className="mt-0.5 flex flex-col gap-0.5" role="group" aria-label={m.nav.dashboardType}>
          {enabled.map((value) => {
            const href = SEGMENT_META[value].dashboardHref;
            const active = isActive(href);
            const link = (
              <Link key={value} href={href} onClick={onNavigate} className={subClass(active && !(value === 'ORDER_CYCLE' && onStoreSub))} aria-current={active && !onStoreSub ? 'page' : undefined}>
                <span
                  className={cn('size-1 shrink-0 rounded-full', active ? 'bg-brand-accent' : dark ? 'bg-sidebar-muted-foreground/60' : 'bg-muted-foreground/60')}
                  aria-hidden="true"
                />
                <span className="truncate">{m.segments[value].label}</span>
              </Link>
            );
            if (value !== 'ORDER_CYCLE') return link;
            // 매장 발주 예측 아래 — 재고를 한 장에 적는 Easy Count.
            return [
              link,
              <Link
                key="easy-count"
                href={EASY_COUNT_HREF}
                onClick={onNavigate}
                className={cn(subClass(onEasyCount), 'pl-14')}
                aria-current={onEasyCount ? 'page' : undefined}
              >
                <NotebookPen className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{m.store.easyCount.title}</span>
              </Link>,
              <Link key="menus" href={MENUS_HREF} onClick={onNavigate} className={cn(subClass(onMenus), 'pl-14')} aria-current={onMenus ? 'page' : undefined}>
                <ChefHat className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{m.store.menus.navLabel}</span>
              </Link>,
            ];
          })}
        </div>
      </div>

      <div>
        {item('/board', 'board', m.nav.items.board, isActive('/board'))}
        {recentPosts && recentPosts.length > 0 && (
          <div className="mt-0.5 flex flex-col gap-0.5" role="group" aria-label={m.nav.recentPosts}>
            {recentPosts.map((post) => (
              <Link key={post.id} href={`/board?tags=${post.tag}`} onClick={onNavigate} className={subClass(false)} title={`[${m.work.board.tags[post.tag]}] ${post.title}`}>
                <span className={cn('size-1.5 shrink-0 rounded-full', postTagDotClassName(post.tag))} aria-hidden="true" />
                <span className="truncate">{post.title}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {item('/settings', 'settings', m.nav.items.settings, isActive('/settings'))}
      {isPlatformAdmin && item('/admin', 'admin', m.nav.items.admin, isActive('/admin'))}
    </>
  );
}
