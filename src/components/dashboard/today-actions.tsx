'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import type { TodayAction, TodayActionKind } from '@/domain/inventory/today-actions';
import type { Messages } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import { localizeReason } from '@/lib/status';

const VISIBLE = 8;

const KIND_VARIANT: Record<TodayActionKind, 'danger' | 'warning' | 'secondary' | 'stagnant' | 'increase'> = {
  order_now: 'danger',
  check_data: 'warning',
  order_soon: 'increase',
  expiration: 'warning',
  reduce: 'stagnant',
};

function describe(action: TodayAction, t: Messages['today'], d: Messages['domain']): string {
  const qty = (action.quantity ?? 0).toLocaleString();
  switch (action.kind) {
    case 'order_now':
      if (action.stockoutBeforeArrival) return format(t.orderNowStockout, { qty });
      if (action.overdueDays) return format(t.orderNowOverdue, { days: action.overdueDays, qty });
      return format(t.orderNowToday, { qty });
    case 'order_soon':
      return format(t.orderSoon, { date: action.orderDate ?? '', qty });
    case 'check_data':
      return format(t.checkData, { reason: action.reason ? localizeReason(action.reason, d) : '' });
    case 'expiration':
      return format(t.expiration, { days: action.daysUntilExpiration ?? 0 });
    case 'reduce':
      return action.stagnantDays ? format(t.reduceStagnant, { days: action.stagnantDays }) : t.reduceOverstock;
  }
}

/** 홈 최상단 — 오늘 해야 할 일을 급한 순서로. 그래프·KPI보다 먼저 본다. */
export function TodayActions({ actions, onSelect }: { actions: TodayAction[]; onSelect: (skuId: string) => void }) {
  const { m } = useI18n();
  const t = m.today;
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? actions : actions.slice(0, VISIBLE);

  return (
    <section aria-labelledby="today-actions-title" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3.5">
        <div>
          <h2 id="today-actions-title" className="text-base font-semibold">
            {t.title}
            {actions.length > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">{actions.length}</span>}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
      </div>
      {actions.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((action) => (
            <li key={`${action.kind}-${action.skuId}`}>
              <button type="button" onClick={() => onSelect(action.skuId)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-muted/50">
                <Badge variant={KIND_VARIANT[action.kind]} className="w-20 shrink-0 justify-center">
                  {t.kinds[action.kind]}
                </Badge>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{action.productName}</span>
                  <span className={cn('block truncate text-xs', action.stockoutBeforeArrival ? 'text-status-danger' : 'text-muted-foreground')}>
                    {describe(action, t, m.domain)}
                    <span className="text-muted-foreground">
                      {' · '}
                      {action.productCode} · {action.warehouseName}
                      {action.supplierName ? ` · ${action.supplierName}` : ''}
                    </span>
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {actions.length > VISIBLE && (
        <div className="border-t border-border px-5 py-2 text-center">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? t.showLess : format(t.showAll, { count: actions.length })}
          </Button>
        </div>
      )}
    </section>
  );
}
