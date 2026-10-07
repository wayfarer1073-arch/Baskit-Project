'use client';

import { formatCurrency, formatNumber } from '@/lib/format';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import type { CompanyKpis } from '@/domain/inventory/types';

interface KpiCardsProps {
  kpis: CompanyKpis;
  fromDate: string | null;
  asOfDate: string;
  /** 상세보기 목록의 품절 SKU 수(180일 이내 전체) — 최근 7일 전환이 0이어도 목록은 열 수 있다. */
  soldOutListCount?: number;
  onOpenSoldOutList?: () => void;
}

export function KpiCards({ kpis, fromDate, asOfDate, soldOutListCount = 0, onOpenSoldOutList }: KpiCardsProps) {
  const { m } = useI18n();
  const t = m.dashboard.kpi;
  const unit = (n: number | string) => format(m.dashboard.unit, { count: typeof n === 'number' ? formatNumber(n) : n });
  const s = kpis.snapshot;
  const percent = (value: number | null) => (value === null ? t.notComputable : `${(value * 100).toFixed(1)}%`);
  const quantity = (value: number | null) => (value === null ? t.notComparable : unit(value));
  const periodLabel = fromDate ? format(t.periodRange, { from: fromDate, to: asOfDate }) : t.periodDefault;
  // 집계 시작일: 특정 날짜 조회는 데이터가 실제로 처음 쌓이기 시작한 날짜(firstSeenDate 최솟값),
  // 기간 조회는 선택한 시작일(fromDate) — 단 자료 자체가 그 시작일보다 늦게부터 쌓였다면(신규 SKU
  // 집합 등) 실제로 확인 가능한 가장 이른 날짜로 보정한다.
  const collectionStartDate = fromDate ? (s.earliestFirstSeenDate && s.earliestFirstSeenDate > fromDate ? s.earliestFirstSeenDate : fromDate) : s.earliestFirstSeenDate;
  const unexplainedList = s.unexplainedIncreaseSkus
    .slice(0, 8)
    .map((x) => `${x.productCode}(${x.observedDate})`)
    .join(', ');
  const unexplainedMore = s.unexplainedIncreaseSkus.length > 8 ? format(t.unexplainedMore, { count: s.unexplainedIncreaseSkus.length - 8 }) : '';
  return (
    <section className="overflow-hidden rounded-xl border border-border" aria-label={t.aria}>
      <div className="flex items-center gap-1.5 bg-sidebar px-5 py-3.5 text-sidebar-foreground">
        <h2 className="text-base font-semibold">{t.title}</h2>
        <InfoTooltip tone="header">{t.titleTip}</InfoTooltip>
      </div>
      <div className="grid gap-6 px-5 py-5 lg:grid-cols-[1fr_2fr]">
        <div>
          <p className="text-xs text-muted-foreground">{t.value}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{s.knownInventoryValue === null ? t.valueUnknown : formatCurrency(s.knownInventoryValue)}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">{t.valueRule}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {format(t.valueScope, { valued: s.valuedSkuCount, observed: s.observedSkuCount, ratio: percent(s.valuationCoverageRatio), unvalued: s.unvaluedSkuCount })}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Metric
            label={t.soldOut}
            value={unit(s.soldOutSkuCount)}
            emphasis={s.soldOutSkuCount ? 'warning' : undefined}
            detail={t.soldOutDetail}
            tooltip={t.soldOutTip}
            action={
              <button
                type="button"
                onClick={onOpenSoldOutList}
                disabled={soldOutListCount === 0}
                aria-label={t.soldOutList}
                className="rounded px-1 text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              >
                {t.details}
              </button>
            }
          />
          <Metric
            label={t.unexplained}
            value={format(t.unexplainedValue, { qty: formatNumber(s.unexplainedIncreaseTotal ?? 0), skus: s.unexplainedIncreaseSkus.length })}
            detail={t.unexplainedDetail}
            tooltip={s.unexplainedIncreaseSkus.length === 0 ? t.unexplainedNone : format(t.unexplainedList, { list: unexplainedList, more: unexplainedMore })}
          />
          <Metric
            label={t.basisDate}
            value={s.newestObservationDate ?? t.noObservation}
            detail={s.newestObservationDate ? format(t.basisDetail, { date: collectionStartDate ?? s.newestObservationDate }) : undefined}
          />
          <Metric label={t.totalSku} value={`${s.comparableSkuCount} / ${kpis.totalSkuCount}`} detail={periodLabel} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 border-t border-border px-5 py-4 sm:grid-cols-4">
        <Metric label={t.decrease} value={quantity(s.observedDecrease)} detail={t.decreaseDetail} />
        <Metric label={t.increase} value={quantity(s.observedIncrease)} detail={t.increaseDetail} />
        <Metric label={t.inbound} value={quantity(s.recordedInbound)} detail={t.inboundDetail} />
        <Metric label={t.depletion} value={quantity(s.estimatedDepletion)} detail={t.depletionDetail} />
      </div>
      <div className="flex items-center gap-1.5 border-t border-border px-5 py-3">
        <p className="text-xs text-muted-foreground">{t.caveat}</p>
        <InfoTooltip>{t.caveatTip}</InfoTooltip>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
  emphasis,
  tooltip,
  action,
}: {
  label: string;
  value: string;
  detail?: string;
  emphasis?: 'danger' | 'warning';
  tooltip?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const valueClass = emphasis === 'danger' ? 'text-status-danger' : emphasis === 'warning' ? 'text-status-warning' : 'text-foreground';
  return (
    <div>
      <div className="flex items-center gap-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        {tooltip && <InfoTooltip>{tooltip}</InfoTooltip>}
      </div>
      <div className="mt-1 flex items-center gap-1">
        <p className={`text-lg font-semibold tabular-nums ${valueClass}`}>{value}</p>
        {action}
      </div>
      {detail && <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  );
}
