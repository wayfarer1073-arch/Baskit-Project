'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { AppNav, useActiveSegment, type NavRecentPost } from '@/components/layout/segment-nav';
import { CALENDAR_HREF, type Segment } from '@/lib/segments';
import { SignOutButton } from '@/components/layout/sign-out-button';
import { useI18n } from '@/components/i18n/i18n-provider';

export type SidebarRecentPost = NavRecentPost;

interface AppSidebarProps {
  userName: string;
  userRole: string;
  workspaceName: string;
  defaultSegment: Segment;
  enabledSegments: Segment[];
  recentPosts?: SidebarRecentPost[];
  isPlatformAdmin?: boolean;
  className?: string;
}

export function AppSidebar({ userName, userRole, workspaceName, defaultSegment, enabledSegments, recentPosts, isPlatformAdmin, className }: AppSidebarProps) {
  const segment = useActiveSegment(defaultSegment, enabledSegments);
  const { m } = useI18n();

  return (
    <aside className={cn('sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground', className)}>
      {/* 로고를 누르면 매일 가장 먼저 여는 캘린더로 간다. */}
      <Link href={CALENDAR_HREF} className="flex items-center gap-2.5 px-5 py-6 transition-opacity hover:opacity-85" aria-label={m.nav.items.calendar}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-icon.png" alt="" className="size-9 shrink-0" />
        <span className="min-w-0 leading-tight">
          <span className="block text-base font-semibold tracking-tight">Limenote</span>
          <span className="block truncate text-xs text-sidebar-muted-foreground" title={workspaceName}>
            {workspaceName}
          </span>
        </span>
      </Link>

      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3" aria-label={m.nav.siteMenu}>
        <AppNav segment={segment} enabled={enabledSegments} variant="sidebar" recentPosts={recentPosts} isPlatformAdmin={isPlatformAdmin} />
      </nav>

      <div className="flex items-center justify-between gap-2 px-4 py-4">
        <div className="min-w-0 text-xs leading-tight">
          <div className="truncate font-medium text-sidebar-foreground">{userName}</div>
          <div className="text-sidebar-muted-foreground">{userRole}</div>
        </div>
        <SignOutButton className="text-sidebar-muted-foreground hover:bg-sidebar-hover-bg hover:text-sidebar-foreground" />
      </div>
    </aside>
  );
}
