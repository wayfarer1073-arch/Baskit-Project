'use client';

import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { SectionPanel, SummaryMetric, SummaryPanel } from '@/components/segment-dashboards/dashboard-parts';
import { STATUS_VARIANT } from '@/components/segment-dashboards/periodic-parts';
import type { PeriodicRangeSummary, StoreRangeSummary } from '@/domain/segments/range-compare';
import { formatMoney, formatNumber, formatSigned } from '@/lib/format';
import { usePaged } from '@/lib/use-paged';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';

const qty = (value: number | null) => (value === null ? '—' : formatNumber(value));

/** 비정기 실사 대시보드의 '기간 비교' — 시작일·종료일 추정 재고를 품목별로 비교한다. */
export function PeriodicRangePanel({ summary, onSelectSku }: { summary: PeriodicRangeSummary; onSelectSku: (skuId: string) => void }) {
  const { m } = useI18n();
  const t = m.periodic.dashboard.range;
  const paged = usePaged(summary.rows, `${summary.from}|${summary.to}`);
  const change = summary.toStock - summary.fromStock;
  return (
    <>
      <SummaryPanel title={`${t.title} · ${summary.from} ~ ${summary.to}`} tooltip={t.tip}>
        <SummaryMetric
          label={t.stock}
          value={formatSigned(change)}
          emphasis={change < 0 ? 'warning' : change > 0 ? 'normal' : undefined}
          detail={format(t.stockDetail, { from: formatNumber(summary.fromStock), to: formatNumber(summary.toStock) })}
        />
        <SummaryMetric label={t.counted} value={formatNumber(summary.countedSkus)} detail={format(t.countedDetail, { days: summary.days })} />
        <SummaryMetric label={t.newlyOut} value={formatNumber(summary.newlyOut)} emphasis={summary.newlyOut ? 'danger' : undefined} detail={t.newlyOutDetail} />
        <SummaryMetric label={t.recovered} value={formatNumber(summary.recovered)} emphasis={summary.recovered ? 'normal' : undefined} detail={t.recoveredDetail} />
      </SummaryPanel>
      <SectionPanel title={t.tableTitle} description={t.tip}>
        {summary.rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t.empty}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">{t.colProduct}</TableHead>
                  <TableHead className="text-right">{t.colFrom}</TableHead>
                  <TableHead className="text-right">{t.colTo}</TableHead>
                  <TableHead className="text-right">{t.colChange}</TableHead>
                  <TableHead className="pr-5 text-right">{t.colCounted}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.pageItems.map((r) => (
                  <TableRow key={r.skuId} className="cursor-pointer" onClick={() => onSelectSku(r.skuId)}>
                    <TableCell className="pl-5">
                      <p className="font-medium">{r.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.warehouseName} · {r.productCode}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.fromStatus === null ? <span className="text-xs text-muted-foreground">{t.noHistory}</span> : qty(r.fromStock)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge variant={STATUS_VARIANT[r.toStatus]}>{m.periodic.status[r.toStatus]}</Badge>
                        {qty(r.toStock)}
                      </span>
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-medium tabular-nums',
                        r.change !== null && r.change < 0 && 'text-status-warning',
                        r.change !== null && r.change > 0 && 'text-status-normal',
                      )}
                    >
                      {r.change === null ? '—' : formatSigned(r.change)}
                    </TableCell>
                    <TableCell className="pr-5 text-right text-xs text-muted-foreground">{r.countedInRange ? t.countedYes : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {paged.totalPages > 1 && (
              <div className="border-t border-border px-5 py-2.5">
                <Pagination page={paged.page} totalPages={paged.totalPages} onChange={paged.setPage} />
              </div>
            )}
          </>
        )}
      </SectionPanel>
    </>
  );
}

/** 매장 발주 예측 대시보드의 '기간 비교' — 기간 매출(직전 같은 길이 기간 대비)과 기간 중 발주. */
export function StoreRangePanel({ summary, onSelectItem }: { summary: StoreRangeSummary; onSelectItem: (itemId: string) => void }) {
  const { m, locale } = useI18n();
  const t = m.store.dashboard.range;
  const paged = usePaged(summary.items, `${summary.from}|${summary.to}`);
  const pct = summary.changePct === null ? null : `${summary.changePct >= 0 ? '+' : ''}${summary.changePct.toFixed(1)}%`;
  return (
    <>
      <SummaryPanel title={`${t.title} · ${summary.from} ~ ${summary.to}`} tooltip={t.tip}>
        <SummaryMetric label={t.sales} value={formatMoney(summary.salesTotal, locale)} detail={format(t.salesDetail, { entered: summary.salesDays, days: summary.days })} />
        <SummaryMetric
          label={t.average}
          value={summary.dailyAverage === null ? '—' : formatMoney(summary.dailyAverage, locale)}
          emphasis={summary.changePct === null ? undefined : summary.changePct >= 0 ? 'normal' : 'warning'}
          detail={pct === null ? t.noPrevious : format(t.vsPrevious, { pct, from: summary.previous.from, to: summary.previous.to })}
        />
        <SummaryMetric label={t.orders} value={format(t.times, { count: summary.orderCount })} detail={format(t.ordersDetail, { count: summary.items.length })} />
      </SummaryPanel>
      <SectionPanel title={t.orders} description={t.tip}>
        {summary.items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t.ordersEmpty}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">{t.colItem}</TableHead>
                  <TableHead className="text-right">{t.colOrders}</TableHead>
                  <TableHead className="pr-5 text-right">{t.colQuantity}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.pageItems.map((i) => (
                  <TableRow key={i.itemId} className="cursor-pointer" onClick={() => onSelectItem(i.itemId)}>
                    <TableCell className="pl-5 font-medium">{i.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{format(t.times, { count: i.orderCount })}</TableCell>
                    <TableCell className="pr-5 text-right tabular-nums">
                      {formatNumber(i.quantity)} {i.unit}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {paged.totalPages > 1 && (
              <div className="border-t border-border px-5 py-2.5">
                <Pagination page={paged.page} totalPages={paged.totalPages} onChange={paged.setPage} />
              </div>
            )}
          </>
        )}
      </SectionPanel>
    </>
  );
}
