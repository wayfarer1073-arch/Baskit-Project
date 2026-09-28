'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { SegmentNavLinks, SegmentSwitcher, useActiveSegment } from '@/components/layout/segment-nav';
import type { Segment } from '@/lib/segments';
import { SignOutButton } from '@/components/layout/sign-out-button';
import { postTagLabel, postTagDotClassName, type PostTagValue } from '@/lib/post-tags';

export interface SidebarRecentPost {
  id: string;
  tag: PostTagValue;
  title: string;
}

interface AppSidebarProps {
  userName: string;
  userRole: string;
  workspaceName: string;
  defaultSegment: Segment;
  recentPosts?: SidebarRecentPost[];
  className?: string;
}

export function AppSidebar({ userName, userRole, workspaceName, defaultSegment, recentPosts, className }: AppSidebarProps) {
  const segment = useActiveSegment(defaultSegment);

  return (
    <aside
      className={cn(
        'sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        className,
      )}
    >
      <div className="flex items-center gap-2.5 px-5 py-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-icon.png" alt="" className="size-9 shrink-0" />
        <span className="min-w-0 leading-tight">
          <span className="block text-base font-semibold tracking-tight">Limenote</span>
          <span className="block truncate text-xs text-sidebar-muted-foreground" title={workspaceName}>
            {workspaceName}
          </span>
        </span>
      </div>

      <SegmentSwitcher segment={segment} className="px-3 pb-3" />

      <nav className="flex flex-col gap-1 px-3 py-2">
        <p className="px-3 pb-1.5 text-[11px] font-medium tracking-wide text-sidebar-muted-foreground">메뉴</p>
        <SegmentNavLinks segment={segment} variant="sidebar" />
      </nav>

      {recentPosts && recentPosts.length > 0 && (
        <div className="mt-auto flex flex-col gap-1 px-3 py-3">
          <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-sidebar-muted-foreground">최근 게시글</p>
          {recentPosts.map((post) => (
            <Link
              key={post.id}
              href={`/board?tags=${post.tag}`}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-sidebar-muted-foreground transition-colors hover:bg-sidebar-hover-bg hover:text-sidebar-foreground"
            >
              <span className={cn('size-1.5 shrink-0 rounded-full', postTagDotClassName(post.tag))} aria-hidden="true" />
              <span className="truncate" title={`[${postTagLabel(post.tag)}] ${post.title}`}>
                {post.title}
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className={cn('flex items-center justify-between gap-2 border-t border-sidebar-border px-4 py-4', !recentPosts?.length && 'mt-auto')}>
        <div className="min-w-0 text-xs leading-tight">
          <div className="truncate font-medium text-sidebar-foreground">{userName}</div>
          <div className="text-sidebar-muted-foreground">{userRole}</div>
        </div>
        <SignOutButton className="text-sidebar-muted-foreground hover:bg-sidebar-hover-bg hover:text-sidebar-foreground" />
      </div>
    </aside>
  );
}
