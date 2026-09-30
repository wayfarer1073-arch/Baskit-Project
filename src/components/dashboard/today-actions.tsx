'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

// 접힘 상태는 이 브라우저에 기억한다(사람마다 다른 화면 취향). 저장소를 못 쓰는 환경에서도 이번 방문 동안은 동작하도록
// 메모리 값을 함께 둔다. 서버 렌더링 때는 펼친 상태로 그린 뒤, 브라우저에서 저장된 값으로 맞춘다.
const OPEN_KEY = 'limenote_today_actions_open';
const openListeners = new Set<() => void>();
let openInMemory = true;

function readOpen(): boolean {
  try {
    const saved = window.localStorage.getItem(OPEN_KEY);
    return saved === null ? openInMemory : saved !== '0';
  } catch {
    return openInMemory;
  }
}

function writeOpen(next: boolean) {
  openInMemory = next;
  try {
    window.localStorage.setItem(OPEN_KEY, next ? '1' : '0');
  } catch {
    // 저장할 수 없으면 메모리 값만 쓴다.
  }
  openListeners.forEach((listener) => listener());
}

function subscribeOpen(listener: () => void) {
  openListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === OPEN_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    openListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const KIND_ORDER: TodayActionKind[] = ['order_now', 'order_soon', 'check_data', 'expiration', 'reduce'];
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/** 홈 최상단 — 오늘 해야 할 일을 급한 순서로. 그래프·KPI보다 먼저 본다. 유형 태그로 거르고 10/20/50/100개씩 본다. */
export function TodayActions({ actions, onSelect }: { actions: TodayAction[]; onSelect: (skuId: string) => void }) {
  const { m } = useI18n();
  const t = m.today;
  const [kind, setKind] = useState<TodayActionKind | 'all'>('all');
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const open = useSyncExternalStore(subscribeOpen, readOpen, () => true);
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
      <div className="flex flex-wrap items-center justify-between gap-3 bg-sidebar px-5 py-3.5 text-sidebar-foreground">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 id="today-actions-title" className="text-base font-semibold">
              {t.title}
            </h2>
            {/* 눌리는 버튼이 아니라 개수를 눈에 띄게 보여주는 표시다. */}
            <span className="inline-flex items-center rounded-full bg-brand-accent px-2.5 py-0.5 text-xs font-semibold text-black tabular-nums">
              {format(t.skuCount, { count: actions.length.toLocaleString() })}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-sidebar-muted-foreground">{t.subtitle}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-foreground hover:text-brand-accent"
          aria-expanded={open}
          aria-controls="today-actions-body"
          onClick={() => writeOpen(!open)}
        >
          {open ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
          {open ? t.hide : t.show}
        </Button>
      </div>
      {!open ? null : actions.length === 0 ? (
        <p id="today-actions-body" className="px-5 py-6 text-sm text-muted-foreground">
          {t.empty}
        </p>
      ) : (
        <div id="today-actions-body">
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
        </div>
      )}
    </section>
  );
}
