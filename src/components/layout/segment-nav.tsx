'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, ChefHat, ChevronDown, LayoutDashboard, MessagesSquare, NotebookPen, Settings, ShieldCheck } from 'lucide-react';
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

const ICONS = { calendar: CalendarDays, dashboard: LayoutDashboard, board: MessagesSquare, easyCount: NotebookPen, menus: ChefHat, settings: Settings, admin: ShieldCheck };

/** 커서가 스치기만 해도 열리고 닫히지 않도록 두는 여유(ms). */
const HOVER_OPEN_DELAY = 120;
const HOVER_CLOSE_DELAY = 200;

/**
 * 사이드바·모바일 메뉴 공용: 캘린더 / 대시보드(유형별 하위 메뉴) / 게시판(유형별 최근 글) / 매장 도구(Easy Count·메뉴·레시피) / 설정 / 운영자 콘솔.
 * 대시보드 하위 메뉴는 평소 접혀 있다가 커서를 올리거나(마우스) 포커스가 오면 펼쳐지고, 대시보드 화면에서는 펼친 채로 둔다.
 * 터치 기기에서는 옆 화살표로 펼치고 접는다.
 */
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

  const onEasyCount = isActive(EASY_COUNT_HREF);
  const onMenus = isActive(MENUS_HREF);
  // Easy Count·메뉴·레시피는 주소가 /dashboard 아래지만 메뉴에서는 따로 빠져 있으므로 대시보드로 치지 않는다.
  const onDashboard = pathname.startsWith('/dashboard') && !onEasyCount && !onMenus;
  const storeTools = enabled.includes('ORDER_CYCLE');

  return (
    <>
      {item(CALENDAR_HREF, 'calendar', m.nav.items.calendar, isActive(CALENDAR_HREF))}

      <DashboardGroup pinned={onDashboard} label={m.nav.dashboardType} dark={dark}>
        {item(SEGMENT_META[segment].dashboardHref, 'dashboard', m.nav.items.dashboard, onDashboard)}
        {enabled.map((value) => {
          const href = SEGMENT_META[value].dashboardHref;
          const active = isActive(href) && onDashboard;
          return (
            <Link key={value} href={href} onClick={onNavigate} className={subClass(active)} aria-current={active ? 'page' : undefined}>
              <span
                className={cn('size-1 shrink-0 rounded-full', active ? 'bg-brand-accent' : dark ? 'bg-sidebar-muted-foreground/60' : 'bg-muted-foreground/60')}
                aria-hidden="true"
              />
              <span className="truncate">{m.segments[value].label}</span>
            </Link>
          );
        })}
      </DashboardGroup>

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

      {/* 매장 도구 — 나중에 설정 일부와 함께 별도 묶음으로 옮길 자리라 설정 바로 위에 둔다. */}
      {storeTools && item(EASY_COUNT_HREF, 'easyCount', m.store.easyCount.title, onEasyCount)}
      {storeTools && item(MENUS_HREF, 'menus', m.store.menus.navLabel, onMenus)}

      {item('/settings', 'settings', m.nav.items.settings, isActive('/settings'))}
      {isPlatformAdmin && item('/admin', 'admin', m.nav.items.admin, isActive('/admin'))}
    </>
  );
}

/**
 * 대시보드 항목 + 유형별 하위 메뉴. 첫 자식이 대시보드 항목, 나머지가 하위 메뉴다.
 * 펼침: 커서 올림(마우스만, 살짝 지연) · 키보드 포커스가 들어옴 · 화살표로 직접 펼침 · 대시보드 화면(pinned).
 * 접힌 하위 메뉴는 inert로 두어 Tab·스크린리더가 지나가지 않게 한다.
 */
function DashboardGroup({ pinned, label, dark, children }: { pinned: boolean; label: string; dark: boolean; children: React.ReactNode[] }) {
  const pathname = usePathname();
  const listId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // 화살표로 직접 펼치거나 접은 상태 — 화면을 옮기면 다시 기본(pinned)으로 돌아간다.
  const [manual, setManual] = useState<{ path: string; open: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  const manualOpen = manual && manual.path === pathname ? manual.open : null;
  const expanded = hovered || focused || (manualOpen ?? pinned);

  function hoverTo(next: boolean, e: React.PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHovered(next), next ? HOVER_OPEN_DELAY : HOVER_CLOSE_DELAY);
  }

  const [head, ...subs] = children;
  return (
    <div
      onPointerEnter={(e) => hoverTo(true, e)}
      onPointerLeave={(e) => hoverTo(false, e)}
      // 키보드로 들어온 포커스만 — 마우스로 누른 뒤 남는 포커스 때문에 접히지 않는 일이 없게.
      onFocus={(e) => setFocused(e.target.matches(':focus-visible'))}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className="relative">
        {head}
        <button
          type="button"
          onClick={() => {
            setHovered(false);
            setManual({ path: pathname, open: !expanded });
          }}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={label}
          className={cn(
            'absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg transition-colors',
            pinned
              ? 'text-brand-accent-foreground/80 hover:bg-black/10'
              : dark
                ? 'text-sidebar-muted-foreground hover:bg-sidebar-hover-bg hover:text-sidebar-foreground'
                : 'text-muted-foreground hover:bg-secondary/70',
          )}
        >
          <ChevronDown className={cn('size-4 transition-transform duration-200 motion-reduce:transition-none', expanded && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
        inert={!expanded}
      >
        <div className="overflow-hidden">
          <div id={listId} className="mt-0.5 flex flex-col gap-0.5" role="group" aria-label={label}>
            {subs}
          </div>
        </div>
      </div>
    </div>
  );
}
