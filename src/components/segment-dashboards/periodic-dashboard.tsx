'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SectionPanel, SegmentDashboardHeader, SegmentEmptyState, SummaryMetric, SummaryPanel } from '@/components/segment-dashboards/dashboard-parts';
import { compareRecountUrgency, type PeriodicStatus } from '@/domain/segments/periodic-count';
import { STATUS_VARIANT, recountReasonText } from '@/components/segment-dashboards/periodic-parts';
import { PeriodicSkuSheet } from '@/components/segment-dashboards/periodic-sku-sheet';
import type { PeriodicRow } from '@/domain/segments/read-model';
import { formatNumber } from '@/lib/format';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

const PAGE_SIZE = 50;

interface PeriodicDashboardProps {
  asOfDate: string;
  stockoutSoonDays: number;
  recountDays: number;
  rows: PeriodicRow[];
  warehouses: { id: string; name: string }[];
}

function quantity(value: number | null) {
  return value === null ? '—' : `${formatNumber(value)}`;
}

export function PeriodicDashboard({ asOfDate, stockoutSoonDays, recountDays, rows, warehouses }: PeriodicDashboardProps) {
  const { m } = useI18n();
  const t = m.periodic.dashboard;
  const [query, setQuery] = useState('');
  const [warehouseId, setWarehouseId] = useState('all');
  const [recountOnly, setRecountOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [openSkuId, setOpenSkuId] = useState<string | null>(null);

  const summary = useMemo(() => {
    const count = (status: PeriodicStatus) => rows.filter((r) => r.estimate.status === status).length;
    const recount = rows.filter((r) => r.estimate.recountReasons.length > 0).length;
    const avgDays = rows.length ? rows.reduce((sum, r) => sum + r.estimate.daysSinceCount, 0) / rows.length : 0;
    return { out: count('estimated_out'), soon: count('soon'), unknown: count('unknown'), recount, avgDays };
  }, [rows]);

  const recountQueue = useMemo(
    () =>
      rows
        .filter((r) => r.estimate.recountReasons.length > 0)
        .sort((a, b) => compareRecountUrgency(a.estimate, b.estimate))
        .slice(0, 8),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.replace(/\s+/g, '').toLowerCase();
    return rows
      .filter((r) => warehouseId === 'all' || r.warehouseId === warehouseId)
      .filter((r) => !recountOnly || r.estimate.recountReasons.length > 0)
      .filter((r) => !q || `${r.productCode}${r.productName}`.replace(/\s+/g, '').toLowerCase().includes(q))
      .sort((a, b) => compareRecountUrgency(a.estimate, b.estimate));
  }, [rows, query, warehouseId, recountOnly]);

  const header = (
    <SegmentDashboardHeader
      title={t.title}
      description={format(t.description, { date: asOfDate })}
      action={
        <Link
          href="/count"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-accent px-3.5 py-2 text-sm font-medium text-brand-accent-foreground transition-opacity hover:opacity-90"
        >
          <ClipboardCheck className="size-4" aria-hidden="true" />
          {t.enterCount}
        </Link>
      }
    />
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <SegmentEmptyState
          title={t.emptyTitle}
          description={t.emptyBody}
          href="/count"
          cta={t.emptyCta}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <SummaryPanel
        title={t.summaryTitle}
        tooltip={format(t.summaryTip, { days: recountDays })}
        footer={t.summaryFooter}
      >
        <SummaryMetric label={t.out} value={format(t.count, { count: summary.out })} emphasis={summary.out ? 'danger' : undefined} detail={t.outDetail} />
        <SummaryMetric label={t.soon} value={format(t.count, { count: summary.soon })} emphasis={summary.soon ? 'warning' : undefined} detail={format(t.soonDetail, { days: stockoutSoonDays })} />
        <SummaryMetric label={t.recount} value={format(t.count, { count: summary.recount })} detail={format(t.recountDetail, { days: recountDays })} />
        <SummaryMetric label={t.avgDays} value={format(t.avgDaysValue, { days: Math.round(summary.avgDays) })} detail={format(t.tracked, { count: rows.length })} />
      </SummaryPanel>

      {recountQueue.length > 0 && (
        <SectionPanel title={t.queueTitle} description={t.queueDescription}>
          <ul className="divide-y divide-border">
            {recountQueue.map((r) => (
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
                  setVisibleCount(PAGE_SIZE);
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
                  setVisibleCount(PAGE_SIZE);
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
                  setVisibleCount(PAGE_SIZE);
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
                <TableHead>{t.cols.product}</TableHead>
                <TableHead>{t.cols.lastCount}</TableHead>
                <TableHead className="text-right">{t.cols.countQty}</TableHead>
                <TableHead className="text-right">{t.cols.inbound}</TableHead>
                <TableHead className="text-right">{t.cols.dailyUsage}</TableHead>
                <TableHead className="text-right">{t.cols.estimate}</TableHead>
                <TableHead>{t.cols.stockout}</TableHead>
                <TableHead>{t.cols.confidence}</TableHead>
                <TableHead>{t.cols.status}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, visibleCount).map((r) => (
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
                    <span className="ml-1.5 text-xs text-muted-foreground">{r.estimate.daysSinceCount === 0 ? t.today : format(t.daysAgo, { days: r.estimate.daysSinceCount })}</span>
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
          {filtered.length > visibleCount && (
            <div className="border-t border-border px-5 py-3 text-center">
              <Button variant="outline" size="sm" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                {format(t.more, { count: Math.min(PAGE_SIZE, filtered.length - visibleCount), shown: visibleCount, total: filtered.length })}
              </Button>
            </div>
          )}
        </div>
      </SectionPanel>

      <PeriodicSkuSheet skuId={openSkuId} asOfDate={asOfDate} onOpenChange={(open) => !open && setOpenSkuId(null)} />
    </div>
  );
}
