'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CalendarDays, ClipboardList, LayoutDashboard, MessagesSquare, Settings, ShieldCheck } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SEGMENT_COOKIE, SEGMENT_META, SEGMENT_ORDER, isSegment, segmentForPath, type NavItem, type Segment } from '@/lib/segments';
import { cn } from '@/lib/utils';

const NAV_ICONS: Record<NavItem['icon'], typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  calendar: CalendarDays,
  records: ClipboardList,
  board: MessagesSquare,
  settings: Settings,
  admin: ShieldCheck,
};

function writeSegmentCookie(segment: Segment) {
  document.cookie = `${SEGMENT_COOKIE}=${segment}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

/**
 * 대시보드 경로에 있으면 그 경로의 방식을, 공용 화면(게시판·설정 등)에서는 마지막으로 고른 방식을
 * 현재 방식으로 본다. 대시보드 URL로 바로 들어온 경우에도 쿠키를 맞춰서, 공용 화면으로 이동해도
 * 사이드바 메뉴가 바뀌지 않게 한다.
 */
export function useActiveSegment(fallback: Segment): Segment {
  const pathname = usePathname();
  const fromPath = segmentForPath(pathname);
  useEffect(() => {
    if (fromPath && fromPath !== fallback) writeSegmentCookie(fromPath);
  }, [fromPath, fallback]);
  return fromPath ?? fallback;
}

interface SegmentSwitcherProps {
  segment: Segment;
  variant?: 'sidebar' | 'drawer';
  onNavigate?: () => void;
  className?: string;
}

export function SegmentSwitcher({ segment, variant = 'sidebar', onNavigate, className }: SegmentSwitcherProps) {
  const labelId = `segment-switcher-label-${variant}`;
  const router = useRouter();

  function change(value: string) {
    if (!isSegment(value)) return;
    writeSegmentCookie(value);
    onNavigate?.();
    router.push(SEGMENT_META[value].dashboardHref);
    router.refresh();
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <p className={cn('px-3 text-[11px] font-medium tracking-wide', variant === 'sidebar' ? 'text-sidebar-muted-foreground' : 'text-muted-foreground')} id={labelId}>
        대시보드 유형
      </p>
      <Select value={segment} onValueChange={change}>
        <SelectTrigger
          aria-labelledby={labelId}
          className={cn(
            'h-auto w-full px-3 py-2 text-left text-sm font-medium',
            variant === 'sidebar' && 'border-sidebar-border bg-sidebar-hover-bg text-sidebar-foreground',
          )}
        >
          <SelectValue>{SEGMENT_META[segment].label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SEGMENT_ORDER.map((value) => (
            <SelectItem key={value} value={value} className="py-2">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{SEGMENT_META[value].label}</span>
                <span className="text-xs text-muted-foreground">{SEGMENT_META[value].audience}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface SegmentNavLinksProps {
  segment: Segment;
  variant: 'sidebar' | 'drawer';
  onNavigate?: () => void;
  isPlatformAdmin?: boolean;
}

const ADMIN_ITEM: NavItem = { href: '/admin', label: '운영자 콘솔', icon: 'admin' };

export function SegmentNavLinks({ segment, variant, onNavigate, isPlatformAdmin }: SegmentNavLinksProps) {
  const pathname = usePathname();
  const items = isPlatformAdmin ? [...SEGMENT_META[segment].nav, ADMIN_ITEM] : SEGMENT_META[segment].nav;
  return (
    <>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = NAV_ICONS[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
              active
                ? 'bg-brand-accent text-brand-accent-foreground'
                : variant === 'sidebar'
                  ? 'text-sidebar-muted-foreground hover:bg-sidebar-hover-bg hover:text-sidebar-foreground'
                  : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
            )}
          >
            <Icon className="size-[18px]" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
