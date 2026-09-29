'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronRight, PackageX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { formatCurrency, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { mergeRowsAcrossWarehouses, type MergedRisk } from '@/domain/inventory/merge';
import type { InventoryRow } from '@/domain/inventory/read-model';
import type { RiskThresholdSettings } from '@/domain/inventory/types';

const RISK_VARIANT: Record<MergedRisk, 'danger' | 'warning' | 'normal' | 'secondary'> = { DANGER: 'danger', WARNING: 'warning', NORMAL: 'normal', UNKNOWN: 'secondary' };

/** 창고를 넘어 같은 품목을 합친 재고 표. 줄을 누르면 창고별 내역, 창고를 누르면 그 창고 품목의 상세가 열린다. */
export function MergedInventoryTable({
  rows,
  settings,
  onSelectSku,
}: {
  rows: InventoryRow[];
  settings: Pick<RiskThresholdSettings, 'stockoutSoonDays' | 'manageMaxDays'>;
  onSelectSku: (skuId: string) => void;
}) {
  const { m } = useI18n();
  const t = m.merged;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const merged = useMemo(() => mergeRowsAcrossWarehouses(rows, settings), [rows, settings]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? merged.filter((r) => r.productName.toLowerCase().includes(q) || r.productCodes.some((c) => c.toLowerCase().includes(q))) : merged;
  }, [merged, query]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-xs text-muted-foreground">{t.hint}</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{format(t.count, { count: visible.length })}</span>
          <Input aria-label={m.costs.filter} placeholder={m.costs.filter} value={query} onChange={(e) => setQuery(e.target.value)} className="h-8 w-48" />
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>{t.colCode}</TableHead>
              <TableHead>{t.colName}</TableHead>
              <TableHead className="text-right">{t.colWarehouses}</TableHead>
              <TableHead className="text-right">{t.colStock}</TableHead>
              <TableHead className="text-right">{t.colRate}</TableHead>
              <TableHead className="text-right">{t.colCoverage}</TableHead>
              <TableHead className="hidden text-right md:table-cell">{t.colValue}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  {t.empty}
                </TableCell>
              </TableRow>
            )}
            {visible.map((r) => {
              const expanded = open.has(r.key);
              return (
                <Fragment key={r.key}>
                  <TableRow className="cursor-pointer" onClick={() => toggle(r.key)} aria-expanded={expanded}>
                    <TableCell className="px-2">
                      <ChevronRight className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-90')} aria-hidden="true" />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.productCodes.join(', ')}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{r.productName}</span>
                        {r.allSoldOut ? (
                          <Badge variant="soldout" className="px-1.5 py-0 text-[10px]">
                            {t.soldOut}
                          </Badge>
                        ) : (
                          <Badge variant={RISK_VARIANT[r.risk]} className="px-1.5 py-0 text-[10px]">
                            {t.risk[r.risk]}
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.members.length}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(r.totalStock)}</TableCell>
                    <TableCell className="text-right tabular-nums" title={r.partialRate ? t.partialRate : undefined}>
                      {r.totalRate === null ? '—' : `${formatNumber(Math.round(r.totalRate * 10) / 10)}${r.partialRate ? '*' : ''}`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.coverageDays === null ? '—' : format(t.coverageValue, { days: formatNumber(Math.round(r.coverageDays)) })}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{formatCurrency(r.totalValue)}</TableCell>
                  </TableRow>
                  {expanded &&
                    r.members.map((mem) => (
                      <TableRow key={mem.skuId} className="cursor-pointer bg-muted/30 hover:bg-muted/60" onClick={() => onSelectSku(mem.skuId)}>
                        <TableCell />
                        <TableCell className="font-mono text-xs text-muted-foreground">{mem.productCode}</TableCell>
                        <TableCell className="text-sm">
                          <span className="inline-flex items-center gap-1.5">
                            {mem.warehouseName}
                            {mem.isSoldOut && <PackageX className="size-3.5 text-status-soldout" aria-label={t.soldOut} />}
                          </span>
                        </TableCell>
                        <TableCell />
                        <TableCell className="text-right tabular-nums">{formatNumber(mem.stock)}</TableCell>
                        <TableCell className="text-right tabular-nums">{mem.rate === null ? '—' : formatNumber(Math.round(mem.rate * 10) / 10)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {mem.rate && mem.rate > 0 ? format(t.coverageValue, { days: formatNumber(Math.round(mem.stock / mem.rate)) }) : '—'}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">{formatCurrency(mem.value)}</TableCell>
                      </TableRow>
                    ))}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
