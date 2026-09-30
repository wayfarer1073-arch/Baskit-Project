'use client';

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Pagination } from '@/components/ui/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePaged } from '@/lib/use-paged';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import type { TodayAction, TodayActionKind } from '@/domain/inventory/today-actions';
import type { Messages } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import { localizeReason } from '@/lib/status';

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

const KIND_ORDER: TodayActionKind[] = ['order_now', 'order_soon', 'check_data', 'expiration', 'reduce'];
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/** 홈 최상단 — 오늘 해야 할 일을 급한 순서로. 그래프·KPI보다 먼저 본다. 유형 태그로 거르고 10/20/50/100개씩 본다. */
export function TodayActions({ actions, onSelect }: { actions: TodayAction[]; onSelect: (skuId: string) => void }) {
  const { m } = useI18n();
  const t = m.today;
  const [kind, setKind] = useState<TodayActionKind | 'all'>('all');
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const counts = useMemo(() => {
    const map = new Map<TodayActionKind, number>();
    for (const a of actions) map.set(a.kind, (map.get(a.kind) ?? 0) + 1);
    return map;
  }, [actions]);
  // 고른 태그가 새 자료에서 사라지면 전체로 돌아간다.
  const activeKind = kind !== 'all' && counts.has(kind) ? kind : 'all';
  const filtered = useMemo(() => (activeKind === 'all' ? actions : actions.filter((a) => a.kind === activeKind)), [actions, activeKind]);
  const { page, totalPages, pageItems: shown, setPage } = usePaged(filtered, `${activeKind}|${pageSize}`, pageSize);

  const chip = (value: TodayActionKind | 'all', label: string, count: number) => {
    const active = activeKind === value;
    return (
      <button
        key={value}
        type="button"
        aria-pressed={active}
        onClick={() => setKind(value)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
          active ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground',
        )}
      >
        {value !== 'all' && <Badge variant={KIND_VARIANT[value]} className="size-2 rounded-full p-0" aria-hidden="true" />}
        {label}
        <span className={cn('tabular-nums', active ? 'text-background/70' : 'text-muted-foreground')}>{count.toLocaleString()}</span>
      </button>
    );
  };

  return (
    <section aria-labelledby="today-actions-title" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="bg-sidebar px-5 py-3.5 text-sidebar-foreground">
        <h2 id="today-actions-title" className="text-base font-semibold">
          {t.title}
          {actions.length > 0 && <span className="ml-2 text-sm font-normal text-sidebar-muted-foreground tabular-nums">{actions.length}</span>}
        </h2>
        <p className="mt-0.5 text-xs text-sidebar-muted-foreground">{t.subtitle}</p>
      </div>
      {actions.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3" role="group" aria-label={t.filterAria}>
            {chip('all', t.all, actions.length)}
            {KIND_ORDER.filter((k) => counts.has(k)).map((k) => chip(k, t.kinds[k], counts.get(k) ?? 0))}
          </div>
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
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-border px-5 py-2.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span id="today-page-size">{t.pageSize}</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-[84px] text-xs" aria-labelledby="today-page-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {format(t.pageSizeOption, { count: n })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </div>
        </>
      )}
    </section>
  );
}
