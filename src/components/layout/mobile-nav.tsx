'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { AppNav, useActiveSegment, type NavRecentPost } from '@/components/layout/segment-nav';
import { SignOutButton } from '@/components/layout/sign-out-button';
import { CALENDAR_HREF, type Segment } from '@/lib/segments';
import { useI18n } from '@/components/i18n/i18n-provider';

interface MobileNavProps {
  userName: string;
  userRole: string;
  workspaceName: string;
  defaultSegment: Segment;
  enabledSegments: Segment[];
  isPlatformAdmin?: boolean;
  recentPosts?: NavRecentPost[];
}

/**
 * sm 미만 화면 전용 메뉴 — 줄 세 개 버튼을 누르면 PC 사이드바와 같은 모양(매트 블랙 바탕·로고·워크스페이스 이름·
 * 같은 메뉴·아래 사용자/로그아웃)의 서랍이 왼쪽에서 열린다.
 */
export function MobileNav({ userName, userRole, workspaceName, defaultSegment, enabledSegments, isPlatformAdmin, recentPosts }: MobileNavProps) {
  const segment = useActiveSegment(defaultSegment, enabledSegments);
  const { m } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setOpen(true)} aria-label={m.nav.openMenu}>
        <Menu className="size-5" />
      </Button>
      <SheetContent
        side="left"
        className="flex w-60 max-w-[85vw] flex-col gap-0 border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground [&>button:last-child]:text-sidebar-muted-foreground [&>button:last-child]:hover:bg-sidebar-hover-bg [&>button:last-child]:hover:text-sidebar-foreground"
      >
        <SheetTitle asChild className="text-sidebar-foreground">
          <Link href={CALENDAR_HREF} onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-5 py-6 pr-12 transition-opacity hover:opacity-85">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.png" alt="" className="size-9 shrink-0" />
            <span className="min-w-0 leading-tight">
              <span className="block text-base font-semibold tracking-tight">Limenote</span>
              <span className="block truncate text-xs font-normal text-sidebar-muted-foreground" title={workspaceName}>
                {workspaceName}
              </span>
            </span>
          </Link>
        </SheetTitle>
        <SheetDescription className="sr-only">{m.nav.siteMenu}</SheetDescription>
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3" aria-label={m.nav.siteMenu}>
          <AppNav segment={segment} enabled={enabledSegments} variant="sidebar" recentPosts={recentPosts} isPlatformAdmin={isPlatformAdmin} onNavigate={() => setOpen(false)} />
        </nav>
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <div className="min-w-0 text-xs leading-tight">
            <div className="truncate font-medium text-sidebar-foreground">{userName}</div>
            <div className="text-sidebar-muted-foreground">{userRole}</div>
          </div>
          <SignOutButton className="text-sidebar-muted-foreground hover:bg-sidebar-hover-bg hover:text-sidebar-foreground" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
