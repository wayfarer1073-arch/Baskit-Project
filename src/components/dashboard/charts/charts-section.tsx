'use client';

import { useMemo } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendLineChart } from './trend-line-chart';
import { RiskDistributionChart } from './risk-distribution-chart';
import { TopDepletionChart } from './top-depletion-chart';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { DailyWarehouseTotal } from '@/domain/inventory/read-model';
import type { InventoryRow } from '@/domain/inventory/read-model';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { InfoTooltip } from '@/components/ui/info-tooltip';

interface ChartsSectionProps {
  rows: InventoryRow[];
  dailyTotals: DailyWarehouseTotal[];
  warehouses: { id: string; code: string; name: string }[];
  chartWarehouseId: string | 'ALL';
  onChangeChartWarehouse: (id: string | 'ALL') => void;
  fromDate: string | null;
  asOfDate: string;
}

export function ChartsSection({ rows, dailyTotals, warehouses, chartWarehouseId, onChangeChartWarehouse, fromDate, asOfDate }: ChartsSectionProps) {
  const { m } = useI18n();
  const t = m.dashboard.charts;
  const filteredRows = useMemo(
    () => (chartWarehouseId === 'ALL' ? rows : rows.filter((r) => r.descriptor.warehouseId === chartWarehouseId)),
    [rows, chartWarehouseId],
  );

  const visibleDailyTotals = useMemo(
    () => dailyTotals.filter((total) => total.date <= asOfDate && (!fromDate || total.date >= fromDate)),
    [dailyTotals, fromDate, asOfDate],
  );
  const stockSeries = useMemo(() => buildDailySeries(visibleDailyTotals, chartWarehouseId, 'totalAvailableStock'), [visibleDailyTotals, chartWarehouseId]);
  const valueSeries = useMemo(() => buildDailySeries(visibleDailyTotals, chartWarehouseId, 'totalInventoryValue'), [visibleDailyTotals, chartWarehouseId]);

  const riskCounts = useMemo(() => {
    let danger = 0;
    let warning = 0;
    let normal = 0;
    let unknown = 0;
    for (const row of filteredRows) {
      if (row.analysis.thresholdRisk.level === 'DANGER') danger += 1;
      else if (row.analysis.thresholdRisk.level === 'WARNING') warning += 1;
      else if (row.analysis.thresholdRisk.level === 'NORMAL') normal += 1;
      else unknown += 1;
    }
    return { danger, warning, normal, unknown };
  }, [filteredRows]);

  const topDepletion = useMemo(
    () =>
      [...filteredRows]
        .filter((r) => !r.descriptor.isB2B && !r.descriptor.isSoldOut && !r.analysis.operating?.staleShippingDays && r.analysis.window7.totalDepletion > 0)
        .sort((a, b) => b.analysis.window7.totalDepletion - a.analysis.window7.totalDepletion)
        .slice(0, 7)
        .map((r) => ({ productName: r.descriptor.productName, depletion: r.analysis.window7.totalDepletion })),
    [filteredRows],
  );

  return (
    <section className="overflow-hidden rounded-xl border border-border">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-sidebar px-5 py-3.5 text-sidebar-foreground">
        <div className="flex items-center gap-1.5">
          <h2 className="text-base font-semibold">{t.title}</h2>
          <InfoTooltip tone="header">{t.subtitle}</InfoTooltip>
        </div>
        <Tabs value={chartWarehouseId} onValueChange={(v) => onChangeChartWarehouse(v)}>
          <TabsList>
            <TabsTrigger value="ALL" className="border-sidebar-foreground/40 bg-sidebar-hover-bg text-sidebar-foreground data-[state=active]:border-transparent data-[state=active]:bg-brand-accent data-[state=active]:text-brand-accent-foreground">{t.all}</TabsTrigger>
            {warehouses.map((w) => (
              <TabsTrigger
                key={w.id}
                value={w.id}
                className="border-sidebar-foreground/40 bg-sidebar-hover-bg text-sidebar-foreground data-[state=active]:border-transparent data-[state=active]:bg-brand-accent data-[state=active]:text-brand-accent-foreground"
              >
                {w.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="grid grid-cols-1 divide-y divide-border lg:grid-cols-2 lg:divide-x">
        <TrendLineChart title={t.stockTrend} data={stockSeries} valueFormatter={(v) => format(m.dashboard.unit, { count: formatNumber(v) })} />
        <TrendLineChart title={t.valueTrend} data={valueSeries} valueFormatter={(v) => formatCurrency(v)} />
        <RiskDistributionChart {...riskCounts} />
        <TopDepletionChart items={topDepletion} />
      </div>
    </section>
  );
}

function buildDailySeries(dailyTotals: DailyWarehouseTotal[], warehouseId: string | 'ALL', metric: 'totalAvailableStock' | 'totalInventoryValue') {
  if (warehouseId !== 'ALL') {
    return dailyTotals
      .filter((t) => t.warehouseId === warehouseId)
      .map((t) => ({ date: t.date, value: t[metric] }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // "전체" 합계는 그 날 실제로 업로드된 창고만 더하면, 일부 창고가 아직 업로드하지 않은 날을
  // 재고가 줄어든 것처럼 보여준다. 지금까지 한 번이라도 업로드한 적 있는 창고 수를 기준으로,
  // 모든 창고가 보고를 마친 날짜만 표시한다.
  const knownWarehouseIds = new Set(dailyTotals.map((t) => t.warehouseId));
  const byDate = new Map<string, { sum: number; warehouseIds: Set<string> }>();
  for (const t of dailyTotals) {
    const entry = byDate.get(t.date) ?? { sum: 0, warehouseIds: new Set<string>() };
    entry.sum += t[metric];
    entry.warehouseIds.add(t.warehouseId);
    byDate.set(t.date, entry);
  }
  return [...byDate.entries()]
    .filter(([, entry]) => entry.warehouseIds.size === knownWarehouseIds.size)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, entry]) => ({ date, value: entry.sum }));
}
