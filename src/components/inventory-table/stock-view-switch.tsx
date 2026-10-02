'use client';

import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n/i18n-provider';
import type { StockView } from '@/components/inventory-table/nowcast-stock';

/**
 * 매트블랙 머리글 안의 '직전 재고 ↔ 예측치' 슬라이드.
 * 오늘 재고가 이미 올라와 추정할 게 없으면 흐리게 비활성화한다(표에는 실제 재고가 그대로 보인다).
 */
export function StockViewSwitch({ view, onChange, disabled }: { view: StockView; onChange: (view: StockView) => void; disabled: boolean }) {
  const t = useI18n().m.dashboard.nowcast.view;
  const estimate = view === 'estimate';
  return (
    <div className={cn('inline-flex items-center gap-2 text-xs select-none', disabled && 'cursor-not-allowed opacity-40')} title={disabled ? t.disabled : undefined}>
      <span className={cn('transition-colors', !estimate ? 'font-semibold text-sidebar-foreground' : 'text-sidebar-muted-foreground')} aria-hidden="true">
        {t.last}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={estimate}
        aria-label={`${t.label}: ${estimate ? t.estimate : t.last}`}
        disabled={disabled}
        onClick={() => onChange(estimate ? 'last' : 'estimate')}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-sidebar-border transition-colors focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-none disabled:cursor-not-allowed',
          estimate ? 'bg-brand-accent' : 'bg-sidebar-hover-bg',
        )}
      >
        <span className={cn('inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform', estimate ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </button>
      <span className={cn('transition-colors', estimate ? 'font-semibold text-sidebar-foreground' : 'text-sidebar-muted-foreground')} aria-hidden="true">
        {t.estimate}
      </span>
    </div>
  );
}
