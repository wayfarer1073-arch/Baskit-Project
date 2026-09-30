'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { SectionPanel, SummaryMetric, SummaryPanel } from '@/components/segment-dashboards/dashboard-parts';
import { DashboardEmptyState, DashboardMasthead } from '@/components/dashboard/dashboard-masthead';
import { PeriodicRangePanel } from '@/components/segment-dashboards/range-panels';
import type { PeriodicRangeSummary } from '@/domain/segments/range-compare';
import { compareRecountUrgency, type PeriodicStatus } from '@/domain/segments/periodic-count';
import { STATUS_VARIANT, recountReasonText } from '@/components/segment-dashboards/periodic-parts';
import { PeriodicSkuSheet } from '@/components/segment-dashboards/periodic-sku-sheet';
import type { PeriodicRow } from '@/domain/segments/read-model';
import { formatNumber } from '@/lib/format';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { Pagination } from '@/components/ui/pagination';
import { usePaged } from '@/lib/use-paged';
import { SortHead, useColumnSort, type SortValue } from '@/components/ui/sort-head';
import { PageSizeSelect, WIDE_PAGE_SIZES } from '@/components/ui/page-size-select';

interface PeriodicDashboardProps {
  asOfDate: string;
  /** 기간 비교의 시작일. 날짜 하나만 보면 null. */
  fromDate: string | null;
  rangeSummary: PeriodicRangeSummary | null;
  stockoutSoonDays: number;
  recountDays: number;
  rows: PeriodicRow[];
  warehouses: { id: string; name: string }[];
}

const STATUS_RANK: Record<PeriodicStatus, number> = { estimated_out: 0, soon: 1, unknown: 2, ok: 3 };
const CONFIDENCE_RANK: Record<string, number | null> = { high: 3, medium: 2, low: 1, none: null };

/** 전체 품목 표의 열별 정렬 값. 상태는 급한 순(추정 품절 → 임박 → 판단 불가 → 여유), 신뢰도는 낮음 → 높음이 오름차순이다. */
const PERIODIC_SORT: Record<'product' | 'lastCount' | 'countQty' | 'inbound' | 'dailyUsage' | 'estimate' | 'stockout' | 'confidence' | 'status', (r: PeriodicRow) => SortValue> = {
  product: (r) => r.productName,
  lastCount: (r) => r.estimate.lastCountDate,
  countQty: (r) => r.estimate.lastCountQuantity,
  inbound: (r) => r.estimate.inboundSinceCount ?? 0,
  dailyUsage: (r) => r.estimate.dailyUsage,
  estimate: (r) => r.estimate.estimatedStock,
  stockout: (r) => r.estimate.estimatedStockoutDate,
  confidence: (r) => CONFIDENCE_RANK[r.estimate.confidence] ?? null,
  status: (r) => STATUS_RANK[r.estimate.status],
};

function quantity(value: number | null) {
  return value === null ? '—' : `${formatNumber(value)}`;
}

export function PeriodicDashboard({ asOfDate, fromDate, rangeSummary, stockoutSoonDays, recountDays, rows, warehouses }: PeriodicDashboardProps) {
  const { m } = useI18n();
  const t = m.periodic.dashboard;
  const [query, setQuery] = useState('');
  const [warehouseId, setWarehouseId] = useState('all');
  const [recountOnly, setRecountOnly] = useState(false);
  const [openSkuId, setOpenSkuId] = useState<string | null>(null);

  const summary = useMemo(() => {
    const count = (status: PeriodicStatus) => rows.filter((r) => r.estimate.status === status).length;
    const recount = rows.filter((r) => r.estimate.recountReasons.length > 0).length;
    const avgDays = rows.length ? rows.reduce((sum, r) => sum + r.estimate.daysSinceCount, 0) / rows.length : 0;
    return { out: count('estimated_out'), soon: count('soon'), unknown: count('unknown'), recount, avgDays };
  }, [rows]);

  const recountQueue = useMemo(() => rows.filter((r) => r.estimate.recountReasons.length > 0).sort((a, b) => compareRecountUrgency(a.estimate, b.estimate)), [rows]);

  const filtered = useMemo(() => {
    const q = query.replace(/\s+/g, '').toLowerCase();
    return rows
      .filter((r) => warehouseId === 'all' || r.warehouseId === warehouseId)
      .filter((r) => !recountOnly || r.estimate.recountReasons.length > 0)
      .filter((r) => !q || `${r.productCode}${r.productName}`.replace(/\s+/g, '').toLowerCase().includes(q))
      .sort((a, b) => compareRecountUrgency(a.estimate, b.estimate));
  }, [rows, query, warehouseId, recountOnly]);

  const queuePaged = usePaged(recountQueue);
  const [tablePageSize, setTablePageSize] = useState<number>(WIDE_PAGE_SIZES[0]);
  const tableSort = useColumnSort(filtered, PERIODIC_SORT);
  const tablePaged = usePaged(tableSort.sorted, `${query}|${warehouseId}|${recountOnly}|${tablePageSize}|${tableSort.sortKey}`, tablePageSize);

  const header = (
    <DashboardMasthead
      segment="PERIODIC_COUNT"
      title={m.dashboard.title}
      segmentLabel={m.segments.PERIODIC_COUNT.label}
      description={fromDate ? format(m.dashboard.range, { from: fromDate, to: asOfDate }) : format(m.dashboard.asOf, { date: asOfDate })}
      asOfDate={asOfDate}
      fromDate={fromDate}
    />
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-7">
        {header}
        <DashboardEmptyState title={t.emptyTitle} body={t.emptyBody} href={`/upload?date=${asOfDate}&mode=PERIODIC_COUNT`} cta={m.dashboard.goUpload} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {rangeSummary && <PeriodicRangePanel summary={rangeSummary} onSelectSku={setOpenSkuId} />}

      <SummaryPanel title={t.summaryTitle} tooltip={format(t.summaryTip, { days: recountDays })} footer={t.summaryFooter}>
        <SummaryMetric label={t.out} value={format(t.count, { count: summary.out })} emphasis={summary.out ? 'danger' : undefined} detail={t.outDetail} />
        <SummaryMetric
          label={t.soon}
          value={format(t.count, { count: summary.soon })}
          emphasis={summary.soon ? 'warning' : undefined}
          detail={format(t.soonDetail, { days: stockoutSoonDays })}
        />
        <SummaryMetric label={t.recount} value={format(t.count, { count: summary.recount })} detail={format(t.recountDetail, { days: recountDays })} />
        <SummaryMetric label={t.avgDays} value={format(t.avgDaysValue, { days: Math.round(summary.avgDays) })} detail={format(t.tracked, { count: rows.length })} />
      </SummaryPanel>

      {recountQueue.length > 0 && (
        <SectionPanel title={t.queueTitle} description={t.queueDescription}>
          <ul className="divide-y divide-border">
            {queuePaged.pageItems.map((r) => (
              <li key={r.skuId}>
                <button
                  type="button"
                  onClick={() => setOpenSkuId(r.skuId)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <Badge variant={STATUS_VARIANT[r.estimate.status]}>{m.periodic.status[r.estimate.status]}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.warehouseName} · {r.productCode}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.estimate.recountReasons.map((reason) => (
                      <span key={reason} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {recountReasonText(reason, m.periodic.reasons)}
                      </span>
                    ))}
                  </div>
                  <p className="w-24 text-right text-sm tabular-nums">
                    <span className="text-xs text-muted-foreground">{t.estimatePrefix}</span>
                    {quantity(r.estimate.estimatedStock)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          {queuePaged.totalPages > 1 && (
            <div className="border-t border-border px-5 py-2.5">
              <Pagination page={queuePaged.page} totalPages={queuePaged.totalPages} onChange={queuePaged.setPage} />
            </div>
          )}
        </SectionPanel>
      )}

      <SectionPanel
        title={t.allTitle}
        description={format(t.allDescription, { shown: filtered.length, total: rows.length })}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
                placeholder={t.searchPlaceholder}
                className="h-8 w-44 pl-8 text-sm"
                aria-label={t.searchAria}
              />
            </div>
            {warehouses.length > 1 && (
              <Select
                value={warehouseId}
                onValueChange={(v) => {
                  setWarehouseId(v);
                }}
              >
                <SelectTrigger className="h-8 w-36 text-sm" aria-label={t.warehouseAria}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.allWarehouses}</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex items-center gap-1.5">
              <Switch
                id="recount-only"
                checked={recountOnly}
                onCheckedChange={(v) => {
                  setRecountOnly(v);
                }}
              />
              <Label htmlFor="recount-only" className="text-xs">
                {t.recountOnly}
              </Label>
            </div>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead label={t.cols.product} dir={tableSort.dirOf('product')} onClick={() => tableSort.toggle('product')} />
                <SortHead label={t.cols.lastCount} dir={tableSort.dirOf('lastCount')} onClick={() => tableSort.toggle('lastCount')} />
                <SortHead label={t.cols.countQty} dir={tableSort.dirOf('countQty')} onClick={() => tableSort.toggle('countQty')} className="text-right" />
                <SortHead label={t.cols.inbound} dir={tableSort.dirOf('inbound')} onClick={() => tableSort.toggle('inbound')} className="text-right" />
                <SortHead label={t.cols.dailyUsage} dir={tableSort.dirOf('dailyUsage')} onClick={() => tableSort.toggle('dailyUsage')} className="text-right" />
                <SortHead label={t.cols.estimate} dir={tableSort.dirOf('estimate')} onClick={() => tableSort.toggle('estimate')} className="text-right" />
                <SortHead label={t.cols.stockout} dir={tableSort.dirOf('stockout')} onClick={() => tableSort.toggle('stockout')} />
                <SortHead label={t.cols.confidence} dir={tableSort.dirOf('confidence')} onClick={() => tableSort.toggle('confidence')} />
                <SortHead label={t.cols.status} dir={tableSort.dirOf('status')} onClick={() => tableSort.toggle('status')} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tablePaged.pageItems.map((r) => (
                <TableRow key={r.skuId} className="cursor-pointer" onClick={() => setOpenSkuId(r.skuId)}>
                  <TableCell className="max-w-64">
                    <button
                      type="button"
                      className="block max-w-full truncate text-left text-sm font-medium underline-offset-4 hover:underline"
                      title={r.productName}
                      onClick={() => setOpenSkuId(r.skuId)}
                    >
                      {r.productName}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {r.warehouseName} · {r.productCode}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {r.estimate.lastCountDate}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {r.estimate.daysSinceCount === 0 ? t.today : format(t.daysAgo, { days: r.estimate.daysSinceCount })}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(r.estimate.lastCountQuantity)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.estimate.inboundSinceCount ? `+${formatNumber(r.estimate.inboundSinceCount)}` : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.estimate.dailyUsage === null ? '—' : r.estimate.dailyUsage.toFixed(1)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{quantity(r.estimate.estimatedStock)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{r.estimate.estimatedStockoutDate ?? '—'}</TableCell>
                  <TableCell className="text-sm">{m.periodic.confidence[r.estimate.confidence]}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.estimate.status]}>{m.periodic.status[r.estimate.status]}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t.noMatch}</p>}
          {filtered.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-border px-5 py-2.5">
              <PageSizeSelect value={tablePageSize} onChange={setTablePageSize} />
              <Pagination page={tablePaged.page} totalPages={tablePaged.totalPages} onChange={tablePaged.setPage} />
            </div>
          )}
        </div>
      </SectionPanel>

      <PeriodicSkuSheet skuId={openSkuId} asOfDate={asOfDate} onOpenChange={(open) => !open && setOpenSkuId(null)} />
    </div>
  );
}
