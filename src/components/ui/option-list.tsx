'use client';

import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * 검색 입력 아래 결과 목록 — 떠 있는 상자가 아니라 입력 바로 아래 자리를 차지하므로 카드·대화상자 끝에서 잘리지 않고,
 * 결과가 많으면 목록 안에서 스크롤된다.
 */
export function OptionList({ id, className, children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <ul id={id} role="listbox" className={cn('mt-1 max-h-56 overflow-y-auto overscroll-contain rounded-md border border-border bg-popover shadow-sm', className)}>
      {children}
    </ul>
  );
}

/**
 * 결과 목록을 언제 보일지 — 입력에 포커스가 있을 때만 열고, 바깥을 누르거나(포커스가 나가면) Esc를 누르면 닫는다.
 * 목록의 버튼에는 optionProps를 붙여 누르는 동안 입력의 포커스가 빠지지 않게 한다.
 */
export function useOptionListOpen() {
  const [focused, setFocused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return {
    focused,
    close: () => setFocused(false),
    inputProps: {
      onFocus: () => {
        if (timer.current) clearTimeout(timer.current);
        setFocused(true);
      },
      onBlur: () => {
        timer.current = setTimeout(() => setFocused(false), 120);
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') setFocused(false);
      },
    },
    optionProps: { onMouseDown: (e: React.MouseEvent) => e.preventDefault() },
  };
}
