'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useI18n } from '@/components/i18n/i18n-provider';
import { NAVIGATION_START_EVENT } from '@/lib/navigation-feedback';

/** 이만큼 안에 끝나는 이동은 스피너를 띄우지 않는다 — 빠른 이동에서 깜빡이지 않게. */
const SHOW_DELAY_MS = 250;
/** 이동이 어떤 이유로 끝났다는 신호를 못 받아도 화면이 영영 가려지지 않게. */
const GIVE_UP_MS = 20_000;

function isInternalNavigation(anchor: HTMLAnchorElement, event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  return url.pathname + url.search !== window.location.pathname + window.location.search;
}

/**
 * 화면 이동 중 콘텐츠 영역(사이드바 제외) 가운데에 스피너를 띄우고 배경을 살짝 흐리게 한다.
 * 이동이 끝나면(주소가 바뀌면) 사라진다. 이전 화면은 흐린 채로 보여 어디서 왔는지 잃지 않는다.
 */
export function NavigationOverlay() {
  const { m } = useI18n();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const timers = useRef<{ show?: ReturnType<typeof setTimeout>; giveUp?: ReturnType<typeof setTimeout> }>({});

  useEffect(() => {
    function clearTimers() {
      clearTimeout(timers.current.show);
      clearTimeout(timers.current.giveUp);
    }
    function start() {
      clearTimers();
      timers.current.show = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
      timers.current.giveUp = setTimeout(() => setVisible(false), GIVE_UP_MS);
    }
    function onClick(event: MouseEvent) {
      const anchor = (event.target as Element | null)?.closest?.('a');
      if (anchor instanceof HTMLAnchorElement && isInternalNavigation(anchor, event)) start();
    }
    document.addEventListener('click', onClick, true);
    window.addEventListener(NAVIGATION_START_EVENT, start);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener(NAVIGATION_START_EVENT, start);
      clearTimers();
    };
  }, []);

  // 주소가 바뀌면 = 새 화면이 그려졌으면 끝.
  useEffect(() => {
    clearTimeout(timers.current.show);
    clearTimeout(timers.current.giveUp);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(false);
  }, [pathname, searchParams]);

  if (!visible) return null;
  return (
    <div className="absolute inset-0 z-30 bg-background/40 backdrop-blur-[2px] animate-in fade-in duration-150" role="status" aria-live="polite">
      <div className="sticky top-0 flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-background/80 px-6 py-5 shadow-lg">
          <span className="size-9 animate-spin rounded-full border-[3px] border-muted border-t-foreground" aria-hidden="true" />
          <span className="text-xs font-medium text-muted-foreground">{m.dashboard.ui.loading}</span>
        </div>
      </div>
    </div>
  );
}
