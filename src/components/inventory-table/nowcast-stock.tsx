'use client';

import type { Nowcast } from '@/domain/inventory/nowcast';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useI18n } from '@/components/i18n/i18n-provider';
import { formatNumber } from '@/lib/format';
import { format } from '@/lib/i18n/locales';

/** 추정치 툴팁 본문 — 무엇에서 얼마를 뺐는지, 범위와 검증 오차. */
function EstimateTip({ nowcast }: { nowcast: Nowcast }) {
  const t = useI18n().m.dashboard.nowcast;
  const method = nowcast.method === 'mean' ? format(t.method.mean, { n: nowcast.parameter ?? 0 }) : nowcast.method ? t.method[nowcast.method] : '';
  return (
    <div className="space-y-1">
      <div className="font-semibold">{t.tipTitle}</div>
      <p>
        {format(t.tipBody, {
          date: nowcast.lastObservedDate,
          stock: formatNumber(nowcast.lastObservedStock),
          days: nowcast.horizonDays,
          depletion: formatNumber(Math.round(nowcast.expectedDepletion ?? 0)),
        })}
      </p>
      <p>{format(t.tipRange, { low: formatNumber(nowcast.low ?? 0), high: formatNumber(nowcast.high ?? 0) })}</p>
      {nowcast.backtest && <p>{format(t.tipAccuracy, { origins: nowcast.backtest.origins, error: (nowcast.backtest.wape * 100).toFixed(1), method })}</p>}
      <p className="opacity-75">{t.tipBasis}</p>
      <p className="opacity-75">{t.tipInbound}</p>
    </div>
  );
}

function UnavailableTip({ nowcast }: { nowcast: Nowcast }) {
  const t = useI18n().m.dashboard.nowcast;
  const reason = nowcast.reason ? format(t.reasons[nowcast.reason], { error: nowcast.backtest ? (nowcast.backtest.wape * 100).toFixed(1) : '—' }) : '';
  return (
    <div className="space-y-1">
      <p>{format(t.unavailableTip, { date: nowcast.lastObservedDate })}</p>
      <p>{reason}</p>
    </div>
  );
}

/** 재고 표의 정상재고 칸 — 추정치면 붉은 느낌표, 추정할 수 없으면 마지막 실제 값 + '예측 불가'. */
export function NowcastStock({ nowcast, fallback }: { nowcast: Nowcast | null | undefined; fallback: string }) {
  const t = useI18n().m.dashboard.nowcast;
  if (!nowcast) return <>{fallback}</>;
  if (nowcast.status === 'estimated') {
    return (
      <span className="inline-flex items-center justify-end gap-1">
        <span>{formatNumber(nowcast.estimatedStock ?? 0)}</span>
        <InfoTooltip tone="alert" label={t.estimateAria}>
          <EstimateTip nowcast={nowcast} />
        </InfoTooltip>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span>{fallback}</span>
      <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
        {t.unavailable}
        <InfoTooltip label={t.unavailable}>
          <UnavailableTip nowcast={nowcast} />
        </InfoTooltip>
      </span>
    </span>
  );
}

/** SKU 상세 상단의 오늘 재고 추정 줄. */
export function NowcastDetail({ nowcast }: { nowcast: Nowcast }) {
  const t = useI18n().m.dashboard.nowcast;
  const estimated = nowcast.status === 'estimated';
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border bg-card p-3">
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{estimated ? t.detailTitle : t.detailUnavailableTitle}</div>
        <div className="mt-1 flex items-center gap-1.5 text-base font-semibold tracking-tight tabular-nums">
          {estimated ? <span>{formatNumber(nowcast.estimatedStock ?? 0)}</span> : <span>{t.unavailable}</span>}
          {estimated ? (
            <InfoTooltip tone="alert" label={t.estimateAria}>
              <EstimateTip nowcast={nowcast} />
            </InfoTooltip>
          ) : (
            <InfoTooltip label={t.unavailable}>
              <UnavailableTip nowcast={nowcast} />
            </InfoTooltip>
          )}
        </div>
        {estimated && (
          <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
            {format(t.tipRange, { low: formatNumber(nowcast.low ?? 0), high: formatNumber(nowcast.high ?? 0) })}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
        {format(t.detailLast, { stock: formatNumber(nowcast.lastObservedStock), date: nowcast.lastObservedDate })}
        <div>{format(t.daysAgo, { days: nowcast.elapsedDays })}</div>
      </div>
    </div>
  );
}
