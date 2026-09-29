'use client';

import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format';
import { formatKstDate, formatKstDateTime } from '@/lib/date';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import type { WarehouseSummary } from '@/domain/inventory/types';

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

const ROWS: { label: string; format: (s: WarehouseSummary) => string }[] = [
  { label: '관리 SKU', format: (s) => `${formatNumber(s.skuCount)}개` },
  { label: '평가 가능한 재고금액', format: (s) => (s.snapshot.knownInventoryValue === null ? '평가 불가' : formatCurrency(s.snapshot.knownInventoryValue)) },
  { label: '평가 가능한 SKU 비율', format: (s) => (s.snapshot.valuationCoverageRatio === null ? '산정 불가' : formatPercent(s.snapshot.valuationCoverageRatio)) },
  { label: '품절 SKU', format: (s) => `${s.snapshot.soldOutSkuCount}개` },
  { label: '위험 SKU', format: (s) => `${formatNumber(s.dangerSkuCount)}개 (${formatPercent(s.dangerRatio)})` },
  { label: '설정 기간 내 소진 추정', format: (s) => formatPercent(s.stockoutSoon30dRatio) },
  { label: '관측상 정체 후보 비율', format: (s) => formatPercent(s.stagnantRatio) },
  { label: '과잉재고 후보 비율', format: (s) => formatPercent(s.overstockCandidateRatio) },
];

export function WarehouseSummaryCards({ summaries: summariesInput, activeWarehouseId, onSelect, latestUploads }: WarehouseSummaryCardsProps) {
  const summaries = [...summariesInput].sort((a, b) => a.warehouseCode.localeCompare(b.warehouseCode));
  return (
    <section className="overflow-hidden rounded-xl border border-border">
      <div className="flex flex-wrap items-center gap-1.5 bg-sidebar px-5 py-3.5 text-sidebar-foreground">
        <h2 className="text-base font-semibold">창고별 요약</h2>
        <InfoTooltip className="text-brand-accent hover:text-brand-accent/80">
          창고마다 서로 다른 상품을 관리하는 별개의 공간이에요. 어느 창고가 더 잘하고 있는지 비교하는 표가 아닙니다.
        </InfoTooltip>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 560 }}>
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-2.5 text-left whitespace-nowrap" style={{ width: 190 }} scope="col">
                <span className="sr-only">지표</span>
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
                최근 업로드
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
                      '업로드 없음'
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
