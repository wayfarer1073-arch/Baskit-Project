'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChefHat, NotebookPen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SectionPanel, SummaryMetric, SummaryPanel } from '@/components/segment-dashboards/dashboard-parts';
import { DashboardEmptyState, DashboardMasthead } from '@/components/dashboard/dashboard-masthead';
import { StoreRangePanel } from '@/components/segment-dashboards/range-panels';
import type { StoreRangeSummary } from '@/domain/segments/range-compare';
import { WeeklySalesChart } from '@/components/segment-dashboards/weekly-sales-chart';
import { CoverageBar, CoverageStatusBadge, remainingText, remainingUnitsText } from '@/components/segment-dashboards/coverage-parts';
import { StoreItemSheet } from '@/components/segment-dashboards/store-item-sheet';
import type { StoreDashboardData, StoreCoverageRow } from '@/domain/segments/read-model';
import { formatMoney } from '@/lib/format';
import { formatExpirationDday } from '@/lib/status';
import { STORE_DEFAULT_EXPIRATION_RISK_DAYS } from '@/domain/segments/store-expiration';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { Pagination } from '@/components/ui/pagination';
import { usePaged } from '@/lib/use-paged';
import { SortHead, useColumnSort, type SortValue } from '@/components/ui/sort-head';
import { PageSizeSelect, WIDE_PAGE_SIZES } from '@/components/ui/page-size-select';

const STATUS_RANK: Record<StoreCoverageRow['analysis']['status'], number> = { order_needed: 0, check_needed: 1, needs_coverage: 2, ok: 3, no_orders: 4, dormant: 5 };

/** 품목별 발주 현황 표의 열별 정렬 값. 상태는 급한 순(발주 필요 → 확인 필요 → …)이 오름차순, '확인 시점'은 지금 확인할 품목이 가장 앞이다. */
const STORE_SORT: Record<'item' | 'lastOrder' | 'coverage' | 'sales' | 'progress' | 'left' | 'checkDate' | 'status', (r: StoreCoverageRow) => SortValue> = {
  item: (r) => r.name,
  lastOrder: (r) => r.analysis.lastOrder?.date ?? null,
  coverage: (r) => r.analysis.estimate.amount,
  sales: (r) => (r.analysis.lastOrder ? r.analysis.consumedSales : null),
  progress: (r) => r.analysis.progress,
  left: (r) => r.analysis.estimatedRemainingUnits,
  checkDate: (r) =>
    r.analysis.status === 'order_needed' || r.analysis.status === 'check_needed' ? '0000-00-00' : r.analysis.status === 'ok' ? r.analysis.expectedCheckDate : null,
  status: (r) => STATUS_RANK[r.analysis.status],
};

function qty(value: number, unit: string, template: string) {
  return format(template, { qty: Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1), unit });
}

/** 소비기한이 임박 기준 안에 든 품목 옆의 작은 경고 표시. */
function ExpiringTag({ row, label, className }: { row: StoreCoverageRow; label: string; className?: string }) {
  if (!row.expiration?.near) return null;
  return (
    <span
      title={row.expiration.date}
      className={cn('inline-flex shrink-0 rounded bg-status-danger-bg px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-status-danger', className)}
    >
      {format(label, { dday: formatExpirationDday(row.expiration.daysLeft) })}
    </span>
  );
}

/**
 * 소비기한을 적은 발주분이 있는 품목만 모아 임박 순으로 따라가는 표. 같은 품목도 발주마다 소비기한이 다르므로
 * 최근 발주분과 직전 발주분을 롯트별 줄로 나눠 보여 준다. 적은 품목이 하나도 없으면 그리지 않는다.
 */
function ExpiryFollowUp({ rows, onOpen }: { rows: StoreCoverageRow[]; onOpen: (itemId: string) => void }) {
  const { m } = useI18n();
  const t = m.store.expiry;
  const tracked = rows
    .filter((r): r is StoreCoverageRow & { expiration: NonNullable<StoreCoverageRow['expiration']> } => r.expiration !== null)
    .sort((a, b) => a.expiration.daysLeft - b.expiration.daysLeft || a.name.localeCompare(b.name));
  const paged = usePaged(tracked);
  if (tracked.length === 0) return null;
  const nearCount = tracked.filter((r) => r.expiration.near).length;
  const left = (days: number) => (days < 0 ? format(t.expired, { days: -days }) : days === 0 ? t.today : format(t.daysLeft, { days }));
  return (
    <SectionPanel
      title={t.panelTitle}
      description={format(t.panelTip, { days: STORE_DEFAULT_EXPIRATION_RISK_DAYS })}
      action={
        <span className="text-xs text-sidebar-muted-foreground">
          {format(t.panelCount, { count: tracked.length })}
          {nearCount > 0 && <span className="ml-2 rounded bg-status-danger-bg px-1.5 py-0.5 font-semibold text-status-danger">{format(t.near, { count: nearCount })}</span>}
        </span>
      }
    >
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.colItem}</TableHead>
              <TableHead>{t.colLot}</TableHead>
              <TableHead>{t.colOrder}</TableHead>
              <TableHead>{t.colExpiration}</TableHead>
              <TableHead className="text-right">{t.colLeft}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.pageItems.flatMap((r) =>
              r.expiration.lots.map((lot, i) => (
                <TableRow key={`${r.itemId}-${lot.role}`} className={cn('cursor-pointer', i > 0 && 'border-t-0')} onClick={() => onOpen(r.itemId)}>
                  {i === 0 && (
                    <TableCell rowSpan={r.expiration.lots.length} className="align-top">
                      <button type="button" className="text-left text-sm font-medium underline-offset-4 hover:underline" onClick={() => onOpen(r.itemId)}>
                        {r.name}
                      </button>
                    </TableCell>
                  )}
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
                        lot.role === 'latest' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {lot.role === 'latest' ? t.lotLatest : t.lotPrevious}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap text-muted-foreground tabular-nums">
                    {format(t.orderValue, { date: lot.orderDate, qty: qty(lot.quantity, r.unit, m.store.units.qty) })}
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap tabular-nums">{lot.date}</TableCell>
                  <TableCell className="text-right">
                    <span
                      className={cn(
                        'inline-flex rounded px-1.5 py-0.5 text-xs whitespace-nowrap tabular-nums',
                        lot.near ? 'bg-status-danger-bg font-semibold text-status-danger' : 'text-muted-foreground',
                      )}
                    >
                      {left(lot.daysLeft)}
                    </span>
                  </TableCell>
                </TableRow>
              )),
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination className="border-t border-border px-5 py-2.5" page={paged.page} totalPages={paged.totalPages} onChange={paged.setPage} />
    </SectionPanel>
  );
}

function growthLabel(rate: number | null, notComparable: string) {
  if (rate === null) return notComparable;
  const pct = Math.round(rate * 1000) / 10;
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

interface StoreDashboardProps extends StoreDashboardData {
  asOfDate: string;
  /** 기간 비교의 시작일. 날짜 하나만 보면 null. */
  fromDate: string | null;
  rangeSummary: StoreRangeSummary | null;
}

export function StoreDashboard({ asOfDate, fromDate, rangeSummary, rows, sales, lastSalesDate, checkRemainingPct }: StoreDashboardProps) {
  const { m, locale } = useI18n();
  const t = m.store.dashboard;
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const checklist = rows.filter((r) => ['order_needed', 'check_needed', 'needs_coverage'].includes(r.analysis.status));
  const checklistPaged = usePaged(checklist);
  const [tablePageSize, setTablePageSize] = useState<number>(WIDE_PAGE_SIZES[0]);
  const tableSort = useColumnSort(rows, STORE_SORT);
  const tablePaged = usePaged(tableSort.sorted, `${tablePageSize}|${tableSort.sortKey}`, tablePageSize);

  const header = (
    <DashboardMasthead
      segment="ORDER_CYCLE"
      title={m.dashboard.title}
      segmentLabel={m.segments.ORDER_CYCLE.label}
      description={fromDate ? format(m.dashboard.range, { from: fromDate, to: asOfDate }) : format(m.dashboard.asOf, { date: asOfDate })}
      asOfDate={asOfDate}
      fromDate={fromDate}
      actions={
        <>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/store/menus">
              <ChefHat aria-hidden="true" />
              {m.store.menus.title}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/store/easy-count">
              <NotebookPen aria-hidden="true" />
              {m.store.easyCount.open}
            </Link>
          </Button>
        </>
      }
    />
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-7">
        {header}
        <DashboardEmptyState title={t.emptyTitle} body={t.emptyBody} href="/settings?tab=store" cta={t.emptyCta} />
      </div>
    );
  }

  const count = (s: StoreCoverageRow['analysis']['status']) => rows.filter((r) => r.analysis.status === s).length;
  const needed = count('order_needed');
  const check = count('check_needed');
  const learning = rows.filter((r) => r.analysis.learnedCycles > 0).length;
  const salesGap = lastSalesDate ? daysBetween(lastSalesDate, asOfDate) : null;

  return (
    <div className="space-y-6">
      {header}

      {(salesGap === null || salesGap > 1) && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-status-warning/40 bg-status-warning-bg px-5 py-3 text-sm">
          <span className="text-status-warning">
            {salesGap === null ? t.noSales : format(t.lastSales, { date: lastSalesDate ?? '', days: salesGap })}
            {t.salesHelp}
          </span>
          <Link href="/store/records#sales" className="font-medium text-status-warning underline underline-offset-4">
            {t.enterSales}
          </Link>
        </div>
      )}

      {rangeSummary && <StoreRangePanel summary={rangeSummary} onSelectItem={setOpenItemId} />}

      <SummaryPanel title={t.summaryTitle} tooltip={format(t.summaryTip, { pct: checkRemainingPct })} footer={t.summaryFooter}>
        <SummaryMetric label={t.needed} value={format(t.count, { count: needed })} emphasis={needed ? 'danger' : undefined} detail={t.neededDetail} />
        <SummaryMetric
          label={t.check}
          value={format(t.count, { count: check })}
          emphasis={check ? 'warning' : undefined}
          detail={format(t.checkDetail, { pct: checkRemainingPct })}
        />
        <SummaryMetric
          label={t.trend}
          value={growthLabel(sales.growthRate, t.notComparable)}
          emphasis={sales.growthRate === null ? undefined : sales.growthRate >= 0 ? 'normal' : 'warning'}
          detail={sales.recentDailyAvg === null ? t.needSales : format(t.dailyAvg, { amount: formatMoney(sales.recentDailyAvg, locale) })}
        />
        <SummaryMetric label={t.learning} value={`${learning} / ${rows.length}`} detail={t.learningDetail} />
      </SummaryPanel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionPanel title={t.checklist} description={t.checklistDescription}>
          {checklist.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t.checklistEmpty}</p>
          ) : (
            <ul className="divide-y divide-border">
              {checklistPaged.pageItems.map((r) => (
                <li key={r.itemId}>
                  <button type="button" onClick={() => setOpenItemId(r.itemId)} className="w-full px-5 py-3 text-left transition-colors hover:bg-muted/50">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{r.name}</span>
                        <ExpiringTag row={r} label={t.expiring} />
                      </span>
                      <CoverageStatusBadge status={r.analysis.status} />
                    </div>
                    <CoverageBar analysis={r.analysis} checkPct={checkRemainingPct} className="mt-2" />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {remainingText(r.analysis, m.store, locale)}
                      {remainingUnitsText(r.analysis, r.unit, m.store) && format(t.expectedLeft, { units: remainingUnitsText(r.analysis, r.unit, m.store) ?? '' })}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Pagination className="border-t border-border px-5 py-2.5" page={checklistPaged.page} totalPages={checklistPaged.totalPages} onChange={checklistPaged.setPage} />
        </SectionPanel>

        <SectionPanel title={t.weekly} description={sales.recentDailyAvg === null ? t.weeklyEmpty : t.weeklyDescription}>
          <div className="px-3 pt-3 pb-2">
            <WeeklySalesChart weekly={sales.weekly} />
          </div>
        </SectionPanel>
      </div>

      <ExpiryFollowUp rows={rows} onOpen={setOpenItemId} />

      <SectionPanel title={t.itemsTitle} description={format(t.itemsDescription, { count: rows.length })}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead label={t.cols.item} dir={tableSort.dirOf('item')} onClick={() => tableSort.toggle('item')} />
                <SortHead label={t.cols.lastOrder} dir={tableSort.dirOf('lastOrder')} onClick={() => tableSort.toggle('lastOrder')} />
                <SortHead label={t.cols.coverage} dir={tableSort.dirOf('coverage')} onClick={() => tableSort.toggle('coverage')} className="text-right" />
                <SortHead label={t.cols.sales} dir={tableSort.dirOf('sales')} onClick={() => tableSort.toggle('sales')} className="text-right" />
                <SortHead label={t.cols.progress} dir={tableSort.dirOf('progress')} onClick={() => tableSort.toggle('progress')} className="min-w-40" />
                <SortHead label={t.cols.left} dir={tableSort.dirOf('left')} onClick={() => tableSort.toggle('left')} />
                <SortHead label={t.cols.checkDate} dir={tableSort.dirOf('checkDate')} onClick={() => tableSort.toggle('checkDate')} />
                <SortHead label={t.cols.status} dir={tableSort.dirOf('status')} onClick={() => tableSort.toggle('status')} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tablePaged.pageItems.map((r) => {
                const a = r.analysis;
                return (
                  <TableRow key={r.itemId} className="cursor-pointer" onClick={() => setOpenItemId(r.itemId)}>
                    <TableCell>
                      <button type="button" className="text-left text-sm font-medium underline-offset-4 hover:underline" onClick={() => setOpenItemId(r.itemId)}>
                        {r.name}
                      </button>
                      <p className="text-xs text-muted-foreground">
                        {r.supplierName ? `${r.supplierName} · ` : ''}
                        {format(t.leadTime, { days: r.leadTimeDays })}
                        {a.learnedCycles > 0 ? format(t.learned, { count: a.learnedCycles }) : ''}
                        <ExpiringTag row={r} label={t.expiring} className="ml-1.5" />
                      </p>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {a.lastOrder ? (
                        <>
                          {a.lastOrder.date}
                          <span className="ml-1.5 text-xs text-muted-foreground">{qty(a.lastOrder.quantity, r.unit, m.store.units.qty)}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <span className="tabular-nums">{a.estimate.amount === null ? '—' : formatMoney(a.estimate.amount, locale)}</span>
                      {a.estimate.source !== 'none' && <p className="text-[11px] text-muted-foreground">{m.store.source[a.estimate.source]}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">{a.lastOrder ? formatMoney(a.consumedSales, locale) : '—'}</TableCell>
                    <TableCell>
                      <CoverageBar analysis={a} checkPct={checkRemainingPct} />
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">{remainingUnitsText(a, r.unit, m.store) ?? '—'}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {a.status === 'ok' ? (a.expectedCheckDate ?? '—') : a.status === 'check_needed' || a.status === 'order_needed' ? t.now : '—'}
                    </TableCell>
                    <TableCell>
                      <CoverageStatusBadge status={a.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-border px-5 py-2.5">
          <PageSizeSelect value={tablePageSize} onChange={setTablePageSize} />
          <Pagination page={tablePaged.page} totalPages={tablePaged.totalPages} onChange={tablePaged.setPage} />
        </div>
      </SectionPanel>

      <StoreItemSheet itemId={openItemId} asOfDate={asOfDate} onOpenChange={(open) => !open && setOpenItemId(null)} />
    </div>
  );
}
