'use client';

import { useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import { Table, TableBody, TableHeader } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { LIST_PAGE_SIZE } from '@/lib/use-paged';
import { InventoryTableRow, InventoryTableStaticHeader } from '@/components/inventory-table/inventory-table';
import type { InventoryRow } from '@/domain/inventory/read-model';
import type { RiskLevel } from '@/domain/inventory/types';
import { useI18n } from '@/components/i18n/i18n-provider';
import type { StockView } from '@/components/inventory-table/nowcast-stock';
import { StockViewSwitch } from '@/components/inventory-table/stock-view-switch';
import { format } from '@/lib/i18n/locales';


// 위험 > 주의 > 개별 확인 > 기준 내 순 — 더 급하게 봐야 할 SKU가 위로 오도록.
const RISK_DISPLAY_RANK: Record<RiskLevel, number> = { DANGER: 0, WARNING: 1, UNKNOWN: 2, NORMAL: 3 };

interface FavoritesSummaryProps {
  rows: InventoryRow[];
  onSelectSku: (skuId: string) => void;
  fromDate: string | null;
  stockView?: StockView;
  onStockViewChange?: (view: StockView) => void;
  stockViewDisabled?: boolean;
}

export function FavoritesSummary({ rows, onSelectSku, fromDate, stockView = 'estimate', onStockViewChange, stockViewDisabled = true }: FavoritesSummaryProps) {
  const { m } = useI18n();
  const t = m.dashboard.favorites;
  const [page, setPage] = useState(1);
  const pageSize = LIST_PAGE_SIZE;
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => RISK_DISPLAY_RANK[a.analysis.thresholdRisk.level] - RISK_DISPLAY_RANK[b.analysis.thresholdRisk.level]),
    [rows],
  );
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <section className="overflow-hidden rounded-xl border border-border">
      <div className="flex flex-wrap items-center gap-1.5 bg-sidebar px-5 py-3.5 text-sidebar-foreground">
        <Star className="size-4 fill-brand-accent text-brand-accent" aria-hidden="true" />
        <h2 className="text-base font-semibold">{t.title}</h2>
        <span className="text-xs text-sidebar-muted-foreground">{format(m.dashboard.unit, { count: rows.length })}</span>
        {onStockViewChange && rows.length > 0 && (
          <div className="ml-auto">
            <StockViewSwitch view={stockView} onChange={onStockViewChange} disabled={stockViewDisabled} />
          </div>
        )}
      </div>
      <div className="space-y-3 p-4 sm:p-5">
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.empty}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <InventoryTableStaticHeader fromDate={fromDate} />
              </TableHeader>
              <TableBody>
                {pageRows.map((r) => (
                  <InventoryTableRow key={r.descriptor.skuId} row={r} fromDate={fromDate} onSelectSku={onSelectSku} stockView={stockView} />
                ))}
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
