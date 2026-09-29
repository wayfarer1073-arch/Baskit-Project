'use client';

import { useState } from 'react';
import { Menu, LogOut } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { SegmentNavLinks, SegmentSwitcher, useActiveSegment } from '@/components/layout/segment-nav';
import type { Segment } from '@/lib/segments';
import { useI18n } from '@/components/i18n/i18n-provider';
import { LanguageSwitcher } from '@/components/i18n/language-switcher';

interface MobileNavProps {
  userName: string;
  userRole: string;
  defaultSegment: Segment;
  isPlatformAdmin?: boolean;
}

/** sm 미만 화면 전용 — 좁은 폭에서 가로 탭 4개+사용자 정보가 글자 단위로 줄바꿈되며 깨지는 문제를 드로어로 해결한다. */
export function MobileNav({ userName, userRole, defaultSegment, isPlatformAdmin }: MobileNavProps) {
  const segment = useActiveSegment(defaultSegment);
  const router = useRouter();
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut({ redirect: false });
      router.push('/login');
      router.refresh();
    } catch {
      toast.error(m.common.signOutFailed);
      router.push('/login');
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setOpen(true)} aria-label={m.nav.openMenu}>
        <Menu className="size-5" />
      </Button>
      <SheetContent side="left" className="w-72 max-w-[85vw] p-0">
        <SheetHeader>
          <SheetTitle asChild>
            <span className="inline-flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-icon.png" alt="" className="size-9 shrink-0" />
              <span className="text-base font-semibold tracking-tight">Limenote</span>
            </span>
          </SheetTitle>
          <SheetDescription className="sr-only">{m.nav.siteMenu}</SheetDescription>
        </SheetHeader>
        <SegmentSwitcher segment={segment} variant="drawer" onNavigate={() => setOpen(false)} className="px-3 pt-3" />
        <nav className="flex flex-col gap-1 p-3">
          <SegmentNavLinks segment={segment} variant="drawer" onNavigate={() => setOpen(false)} isPlatformAdmin={isPlatformAdmin} />
        </nav>
        <div className="px-4 pb-2">
          <LanguageSwitcher tone="light" />
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 border-t p-4">
          <div className="text-xs leading-tight">
            <div className="font-medium text-foreground">{userName}</div>
            <div className="text-muted-foreground">{userRole}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut} disabled={signingOut}>
            <LogOut className="size-4" />
            {m.common.signOut}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
