'use client';

import { NowcastStock } from '@/components/inventory-table/nowcast-stock';
import { useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { Pagination } from '@/components/ui/pagination';
import type { InventoryRow } from '@/domain/inventory/read-model';
import { formatNumber } from '@/lib/format';
import { formatExpirationDday } from '@/lib/status';
import { eventTypeText } from '@/lib/event-types';
import { cn } from '@/lib/utils';
import { LIST_PAGE_SIZE } from '@/lib/use-paged';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

export interface SpecialSchedule {
  title: string | null;
  eventType: string;
  startDate: string;
  endDate: string;
}

interface SpecialStockSummaryProps {
  rows: InventoryRow[];
  schedules: Record<string, SpecialSchedule>;
  asOfDate: string;
  onSelectSku: (skuId: string) => void;
}

/**
 * 특수 관리 재고(정기 발주·B2B 납품·무상 제공 등)만 모은 표. 매일 조금씩 팔린다는 가정의 소진 예측 대신
 * 관리 메모·다음 일정·소비기한처럼 사람이 날짜로 챙기는 정보를 앞에 둔다. 즐겨찾기와는 별개다.
 */
export function SpecialStockSummary({ rows, schedules, asOfDate, onSelectSku }: SpecialStockSummaryProps) {
  const { m } = useI18n();
  const t = m.dashboard.special;
  const [page, setPage] = useState(1);

  // 다음 일정이 가까운 순 → 일정 없는 품목은 소비기한이 가까운 순 → 이름순.
  const sorted = useMemo(() => {
    const key = (r: InventoryRow) => schedules[r.descriptor.skuId]?.startDate ?? '9999-12-31';
    const exp = (r: InventoryRow) => r.analysis.expirationRisk.daysUntilExpiration ?? Number.MAX_SAFE_INTEGER;
    return [...rows].sort((a, b) => key(a).localeCompare(key(b)) || exp(a) - exp(b) || a.descriptor.productName.localeCompare(b.descriptor.productName));
  }, [rows, schedules]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / LIST_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((currentPage - 1) * LIST_PAGE_SIZE, currentPage * LIST_PAGE_SIZE);

  return (
    <section className="overflow-hidden rounded-xl border border-border" aria-labelledby="special-stock-title">
      <div className="flex items-center gap-1.5 bg-sidebar px-5 py-3.5 text-sidebar-foreground">
        <ClipboardList className="size-4 text-brand-accent" aria-hidden="true" />
        <h2 id="special-stock-title" className="text-base font-semibold">
          {t.title}
        </h2>
        <span className="text-xs text-sidebar-muted-foreground">{format(m.dashboard.unit, { count: rows.length })}</span>
        <InfoTooltip tone="header">{t.tip}</InfoTooltip>
      </div>
      <div className="space-y-3 p-4 sm:p-5">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.empty}</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-44">{t.cols.product}</TableHead>
                    <TableHead className="min-w-44">{t.cols.note}</TableHead>
                    <TableHead className="text-right">{t.cols.stock}</TableHead>
                    <TableHead className="text-right">{t.cols.depletion7}</TableHead>
                    <TableHead>{t.cols.expiration}</TableHead>
                    <TableHead className="min-w-40">{t.cols.next}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r) => {
                    const d = r.descriptor;
                    const schedule = schedules[d.skuId];
                    const expiration = r.analysis.expirationRisk;
                    return (
                      <TableRow key={d.skuId} className="cursor-pointer" onClick={() => onSelectSku(d.skuId)}>
                        <TableCell>
                          <button
                            type="button"
                            className="text-left font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectSku(d.skuId);
                            }}
                          >
                            {d.productName}
                          </button>
                          <p className="text-[11px] text-muted-foreground">
                            {d.productCode} · {d.warehouseCode}
                            {d.isSoldOut && <span className="ml-1 font-medium text-status-soldout">{t.soldOut}</span>}
                          </p>
                        </TableCell>
                        <TableCell className={cn('max-w-64 text-xs whitespace-normal', !d.specialNote && 'text-muted-foreground')}>{d.specialNote || t.noNote}</TableCell>
                        <TableCell className="text-right tabular-nums"><NowcastStock nowcast={r.nowcast} fallback={formatNumber(r.analysis.latest.normalStock)} /></TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(r.analysis.window7.totalDepletion)}</TableCell>
                        <TableCell className="text-xs">
                          {expiration.expirationDate ? (
                            <span className={cn('tabular-nums', expiration.isAtRisk && 'font-semibold text-destructive')}>
                              {expiration.expirationDate}
                              {expiration.daysUntilExpiration !== null && (
                                <span className="ml-1 text-muted-foreground">{formatExpirationDday(expiration.daysUntilExpiration)}</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {schedule ? (
                            <>
                              <p className="font-medium">{schedule.title || eventTypeText(schedule.eventType, m.domain.eventTypes)}</p>
                              <p className="text-muted-foreground tabular-nums">
                                {schedule.startDate <= asOfDate && schedule.endDate >= asOfDate ? `${t.today} · ` : ''}
                                {schedule.startDate === schedule.endDate ? schedule.startDate : `${schedule.startDate} ~ ${schedule.endDate}`}
                              </p>
                            </>
                          ) : (
                            <span className="text-muted-foreground">{t.noSchedule}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
          </>
        )}
      </div>
    </section>
  );
}
