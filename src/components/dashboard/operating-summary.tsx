'use client';

import { ShoppingCart, ClipboardList } from 'lucide-react';
import type { InventoryRow } from '@/domain/inventory/read-model';
import { formatCurrency } from '@/lib/format';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

export function OperatingSummary({ rows }: { rows: InventoryRow[] }) {
  const { m } = useI18n();
  const t = m.dashboard.operating;
  const current = rows.filter(r => !r.descriptor.isSoldOut && r.analysis.operating?.staleShippingDays === 0);
  const b2b = current.filter(r => r.descriptor.isB2B);
  const regular = current.filter(r => !r.descriptor.isB2B);
  const value = (list: InventoryRow[]) => {
    const known = list.filter(r => r.analysis.latest.valuationKnown !== false && r.analysis.latest.normalStock >= 0);
    return known.length ? formatCurrency(known.reduce((sum, r) => sum + r.valueBreakdown.normalStockValue, 0)) : t.noValue;
  };
  return (
    <section aria-label={t.aria}>
      <div className="mb-3 flex items-center gap-1.5">
        <h2 className="text-base font-semibold">{t.title}</h2>
        <InfoTooltip>{t.tip}</InfoTooltip>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-sidebar p-5 text-sidebar-foreground">
          <span className="flex size-9 items-center justify-center rounded-full bg-brand-accent text-brand-accent-foreground">
            <ShoppingCart className="size-[18px]" aria-hidden="true" />
          </span>
          <p className="mt-4 text-sm text-sidebar-muted-foreground">{format(t.regular, { count: regular.length })}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value(regular)}</p>
          <p className="mt-1 text-xs text-sidebar-muted-foreground">{t.regularDetail}</p>
        </div>
        <div className="rounded-2xl bg-sidebar p-5 text-sidebar-foreground">
          <span className="flex size-9 items-center justify-center rounded-full bg-brand-accent text-brand-accent-foreground">
            <ClipboardList className="size-[18px]" aria-hidden="true" />
          </span>
          <p className="mt-4 text-sm text-sidebar-muted-foreground">{format(t.b2b, { count: b2b.length })}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value(b2b)}</p>
          <p className="mt-1 text-xs text-sidebar-muted-foreground">{t.b2bDetail}</p>
        </div>
      </div>
    </section>
  );
}
