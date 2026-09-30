'use client';

import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format';
import { formatKstDate, formatKstDateTime } from '@/lib/date';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import type { WarehouseSummary } from '@/domain/inventory/types';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import type { Messages } from '@/lib/i18n/messages';

interface LatestUpload {
  warehouseId: string;
  snapshotDate: string | null;
  uploadedAt: string | null;
}

interface WarehouseSummaryCardsProps {
  summaries: WarehouseSummary[];
  activeWarehouseId: string | 'ALL';
  onSelect: (warehouseId: string | 'ALL') => void;
  latestUploads: LatestUpload[];
}

type Dict = Messages['dashboard'];

function buildRows(t: Dict['warehouses'], d: Dict): { label: string; format: (s: WarehouseSummary) => string }[] {
  const unit = (n: number) => format(d.unit, { count: formatNumber(n) });
  return [
    { label: t.skuCount, format: (s) => unit(s.skuCount) },
    { label: t.value, format: (s) => (s.snapshot.knownInventoryValue === null ? d.kpi.valueUnknown : formatCurrency(s.snapshot.knownInventoryValue)) },
    { label: t.valueRatio, format: (s) => (s.snapshot.valuationCoverageRatio === null ? d.kpi.notComputable : formatPercent(s.snapshot.valuationCoverageRatio)) },
    { label: t.soldOut, format: (s) => unit(s.snapshot.soldOutSkuCount) },
    { label: t.danger, format: (s) => format(t.dangerValue, { count: formatNumber(s.dangerSkuCount), ratio: formatPercent(s.dangerRatio) }) },
    { label: t.stockoutSoon, format: (s) => formatPercent(s.stockoutSoon30dRatio) },
    { label: t.stagnant, format: (s) => formatPercent(s.stagnantRatio) },
    { label: t.overstock, format: (s) => formatPercent(s.overstockCandidateRatio) },
  ];
}

export function WarehouseSummaryCards({ summaries: summariesInput, activeWarehouseId, onSelect, latestUploads }: WarehouseSummaryCardsProps) {
  const { m } = useI18n();
  const t = m.dashboard.warehouses;
  const ROWS = buildRows(t, m.dashboard);
  const summaries = [...summariesInput].sort((a, b) => a.warehouseCode.localeCompare(b.warehouseCode));
  return (
    <section className="overflow-hidden rounded-xl border border-border">
      <div className="flex flex-wrap items-center gap-1.5 bg-sidebar px-5 py-3.5 text-sidebar-foreground">
        <h2 className="text-base font-semibold">{t.title}</h2>
        <InfoTooltip tone="header">{t.tip}</InfoTooltip>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 560 }}>
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-2.5 text-left whitespace-nowrap" style={{ width: 190 }} scope="col">
                <span className="sr-only">{t.metric}</span>
              </th>
              {summaries.map((s) => {
                const active = activeWarehouseId === s.warehouseId;
                return (
                  <th key={s.warehouseId} className="px-3 py-2 text-right" scope="col">
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => onSelect(active ? 'ALL' : s.warehouseId)}
                      className={cn(
                        'whitespace-nowrap rounded-md px-2.5 py-1 text-sm font-semibold outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                        active && 'bg-foreground text-background hover:bg-foreground',
                      )}
                    >
                      {s.warehouseName}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-b border-border last:border-b-0">
                <th scope="row" className="px-5 py-2.5 text-left text-xs whitespace-nowrap font-normal text-muted-foreground">
                  {row.label}
                </th>
                {summaries.map((s) => (
                  <td key={s.warehouseId} className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                    {row.format(s)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-5 py-2.5 text-left text-xs whitespace-nowrap font-normal text-muted-foreground">
                {t.latestUpload}
              </th>
              {summaries.map((s) => {
                const upload = latestUploads.find((u) => u.warehouseId === s.warehouseId);
                return (
                  <td key={s.warehouseId} className="px-3 py-2.5 text-right text-[11px] whitespace-nowrap text-muted-foreground">
                    {upload?.uploadedAt ? (
                      <span className="inline-flex items-center justify-end gap-1">
                        <UploadCloud className="size-3 shrink-0" aria-hidden="true" />
                        {formatKstDate(upload.snapshotDate!)} · {formatKstDateTime(upload.uploadedAt)}
                      </span>
                    ) : (
                      t.noUpload
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
