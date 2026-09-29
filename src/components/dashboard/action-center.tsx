'use client';

import { AlertOctagon, ArrowUpRight, CalendarClock, CheckCircle2, Clock, Flame, PackageOpen, PauseCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { localizeReason } from '@/lib/status';
import type { ActionCenterCard, ActionCenterCategory } from '@/domain/inventory/aggregation';
import type { QuickFilter, TableTab } from '@/lib/inventory-filters';

const CARD_META: Record<ActionCenterCategory, { icon: React.ElementType; chipClassName: string; tab: TableTab; quickFilter: QuickFilter }> = {
  NEW_DANGER: { icon: AlertOctagon, chipClassName: 'bg-status-danger-bg text-status-danger', tab: 'ALL', quickFilter: 'NEW_DANGER' },
  STOCKOUT_SOON: { icon: Clock, chipClassName: 'bg-status-danger-bg text-status-danger', tab: 'STOCKOUT_RISK', quickFilter: 'STOCKOUT_SOON_ONLY' },
  ACCELERATING: { icon: Flame, chipClassName: 'bg-status-warning-bg text-status-warning', tab: 'ACCELERATING', quickFilter: null },
  STAGNANT: { icon: PauseCircle, chipClassName: 'bg-status-stagnant-bg text-status-stagnant', tab: 'STAGNANT', quickFilter: null },
  OVERSTOCK_CANDIDATE: { icon: PackageOpen, chipClassName: 'bg-status-stagnant-bg text-status-stagnant', tab: 'OVERSTOCK_CANDIDATE', quickFilter: null },
  EXPIRATION_RISK: { icon: CalendarClock, chipClassName: 'bg-status-warning-bg text-status-warning', tab: 'EXPIRATION_RISK', quickFilter: null },
};

// 헤드라인으로 띄울 카테고리의 우선순위. buildActionCenterCards의 배열 순서와는 별개로,
// 경영진이 가장 먼저 봐야 할 심각도 순서를 여기서 직접 정한다.
const SEVERITY_ORDER: ActionCenterCategory[] = ['NEW_DANGER', 'STOCKOUT_SOON', 'EXPIRATION_RISK', 'ACCELERATING', 'STAGNANT', 'OVERSTOCK_CANDIDATE'];

interface ActionCenterProps {
  cards: ActionCenterCard[];
  onSelect: (tab: TableTab, quickFilter: QuickFilter) => void;
}

export function ActionCenter({ cards, onSelect }: ActionCenterProps) {
  const { m, locale } = useI18n();
  const t = m.dashboard.actions;
  const titleOf = (card: ActionCenterCard) => t.categories[card.category];
  const detailOf = (card: ActionCenterCard, sample: ActionCenterCard['sampleSkus'][number]) => {
    if (card.category === 'NEW_DANGER') return sample.params.reason ? localizeReason(String(sample.params.reason), m.domain) : t.worsened;
    return format(t.details[card.category], sample.params);
  };
  const count = (n: number) => n.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US');
  const byCategory = new Map(cards.map((c) => [c.category, c]));
  const leadCategory = SEVERITY_ORDER.find((cat) => (byCategory.get(cat)?.count ?? 0) > 0) ?? null;
  const lead = leadCategory ? byCategory.get(leadCategory) : undefined;
  const rest = cards.filter((c) => c.category !== leadCategory);

  return (
    <section aria-label={t.title}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">{t.title}</h2>
        <p className="hidden text-xs text-muted-foreground sm:block">{t.hint}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
        {lead ? (
          <button
            type="button"
            onClick={() => onSelect(CARD_META[lead.category].tab, CARD_META[lead.category].quickFilter)}
            className="group relative col-span-2 flex flex-col justify-between gap-6 rounded-2xl bg-sidebar p-5 text-left text-sidebar-foreground outline-none transition-transform hover:-translate-y-0.5 focus-visible:-translate-y-0.5 lg:col-span-2"
          >
            <div className="flex items-start justify-between">
              <span className="flex size-9 items-center justify-center rounded-full bg-brand-accent text-brand-accent-foreground">
                <AlertOctagon className="size-[18px]" aria-hidden="true" />
              </span>
              <ArrowUpRight className="size-4 text-sidebar-muted-foreground transition-colors group-hover:text-sidebar-foreground" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm text-sidebar-muted-foreground">{titleOf(lead)}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{count(lead.count)}</p>
              {lead.sampleSkus[0] && (
                <p className="mt-1 truncate text-xs text-sidebar-muted-foreground">
                  {lead.sampleSkus[0].productName} · {detailOf(lead, lead.sampleSkus[0])}
                </p>
              )}
            </div>
          </button>
        ) : (
          <div className="col-span-2 flex flex-col justify-between gap-6 rounded-2xl bg-sidebar p-5 text-sidebar-foreground lg:col-span-2">
            <span className="flex size-9 items-center justify-center rounded-full bg-brand-accent text-brand-accent-foreground">
              <CheckCircle2 className="size-[18px]" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm text-sidebar-muted-foreground">{t.noneTitle}</p>
              <p className="mt-1 text-xl font-semibold">{t.none}</p>
            </div>
          </div>
        )}

        {rest.map((card) => {
          const meta = CARD_META[card.category];
          const Icon = meta.icon;
          const sample = card.sampleSkus[0];
          return (
            <button
              key={card.category}
              type="button"
              onClick={() => onSelect(meta.tab, meta.quickFilter)}
              className={cn(
                'group relative flex flex-col justify-between gap-6 rounded-2xl border border-border bg-card p-4 text-left outline-none transition-transform hover:-translate-y-0.5 focus-visible:-translate-y-0.5',
                card.count === 0 && 'opacity-60',
              )}
            >
              <div className="flex items-start justify-between">
                <span className={cn('flex size-8 items-center justify-center rounded-full', meta.chipClassName)}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <ArrowUpRight className="size-3.5 text-muted-foreground/60 transition-colors group-hover:text-foreground" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{titleOf(card)}</p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums">{count(card.count)}</p>
                {sample && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sample.productName}</p>}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
