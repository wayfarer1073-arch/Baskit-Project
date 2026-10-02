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
      <div className="font-semibold">
        {t.tipTitle}
        {nowcast.grade && <span className="ml-1.5 font-normal opacity-75">{format(t.tipGrade, { grade: t.grade[nowcast.grade] })}</span>}
      </div>
      <p>
        {format(t.tipBody, {
          date: nowcast.lastObservedDate,
          stock: formatNumber(nowcast.lastObservedStock),
          days: nowcast.horizonDays,
          depletion: formatNumber(Math.round(nowcast.expectedDepletion ?? 0)),
        })}
      </p>
      <p>{format(t.tipRange, { low: formatNumber(nowcast.low ?? 0), high: formatNumber(nowcast.high ?? 0) })}</p>
      {nowcast.backtest && (
        <p>{format(t.tipAccuracy, { horizon: nowcast.backtest.horizon, origins: nowcast.backtest.origins, error: (nowcast.backtest.wape * 100).toFixed(1), method })}</p>
      )}
      {nowcast.grade === 'LOW' && <p>{t.lowGradeNote}</p>}
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

/** 최근 소진이 없어 직전 재고가 그대로라고 본 경우. */
function FlatTip({ nowcast }: { nowcast: Nowcast }) {
  const t = useI18n().m.dashboard.nowcast;
  return (
    <div className="space-y-1">
      <div className="font-semibold">{t.flatTitle}</div>
      <p>{format(t.flatBody, { date: nowcast.lastObservedDate, stock: formatNumber(nowcast.lastObservedStock) })}</p>
    </div>
  );
}

/** 직전 재고 툴팁 — 언제 값인지, 특수 관리 품목이면 추정하지 않는 이유. */
function LastTip({ nowcast }: { nowcast: Nowcast }) {
  const t = useI18n().m.dashboard.nowcast;
  return (
    <div className="space-y-1">
      <div className="font-semibold">{t.lastTipTitle}</div>
      <p>{format(t.lastTipBody, { date: nowcast.lastObservedDate, days: nowcast.elapsedDays })}</p>
      {nowcast.reason === 'special' && <p className="opacity-75">{t.specialNote}</p>}
    </div>
  );
}

/** 재고를 직전 값으로 볼지, 오늘 추정치로 볼지(일일 대시보드의 전체 재고 표·즐겨찾기 슬라이드). */
export type StockView = 'estimate' | 'last';

/**
 * 재고 표의 정상재고 칸.
 * - 자료가 최신이면 실제 값 그대로.
 * - 특수 관리 품목은 추정하지 않고 직전 재고 + 붉은 느낌표.
 * - '예측치' 보기: 추정치 + 붉은 느낌표(추정 신뢰도 '하'면 '참고용'), 최근 소진이 없으면 직전 값 + 붉은 느낌표(변동 없음),
 *   추정할 수 없으면 직전 값 + '예측 불가'.
 * - '직전 재고' 보기: 직전 값 그대로.
 */
export function NowcastStock({ nowcast, fallback, view = 'estimate' }: { nowcast: Nowcast | null | undefined; fallback: string; view?: StockView }) {
  const t = useI18n().m.dashboard.nowcast;
  if (!nowcast) return <>{fallback}</>;
  if (nowcast.reason === 'special') {
    return (
      <span className="inline-flex items-center justify-end gap-1">
        <span>{fallback}</span>
        <InfoTooltip tone="alert" label={t.lastAria}>
          <LastTip nowcast={nowcast} />
        </InfoTooltip>
      </span>
    );
  }
  if (view === 'last') return <>{fallback}</>;
  if (nowcast.status === 'flat') {
    return (
      <span className="inline-flex items-center justify-end gap-1">
        <span>{fallback}</span>
        <InfoTooltip tone="alert" label={t.estimateAria}>
          <FlatTip nowcast={nowcast} />
        </InfoTooltip>
      </span>
    );
  }
  if (nowcast.status === 'estimated') {
    return (
      <span className="inline-flex flex-col items-end leading-tight">
        <span className="inline-flex items-center gap-1">
          <span>{formatNumber(nowcast.estimatedStock ?? 0)}</span>
          <InfoTooltip tone="alert" label={t.estimateAria}>
            <EstimateTip nowcast={nowcast} />
          </InfoTooltip>
        </span>
        {nowcast.grade === 'LOW' && <span className="text-[10px] text-muted-foreground">{t.reference}</span>}
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
  if (nowcast.reason === 'special') {
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl border bg-card p-3">
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">{t.detailSpecialTitle}</div>
          <div className="mt-1 flex items-center gap-1.5 text-base font-semibold tracking-tight tabular-nums">
            <span>{formatNumber(nowcast.lastObservedStock)}</span>
            <InfoTooltip tone="alert" label={t.lastAria}>
              <LastTip nowcast={nowcast} />
            </InfoTooltip>
          </div>
        </div>
        <div className="shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
          {nowcast.lastObservedDate}
          <div>{format(t.daysAgo, { days: nowcast.elapsedDays })}</div>
        </div>
      </div>
    );
  }
  const estimated = nowcast.status !== 'unavailable';
  const flat = nowcast.status === 'flat';
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border bg-card p-3">
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">
          {estimated ? t.detailTitle : t.detailUnavailableTitle}
          {nowcast.grade && <span className="ml-1.5">· {format(t.tipGrade, { grade: t.grade[nowcast.grade] })}</span>}
          {flat && <span className="ml-1.5">· {t.flatTitle}</span>}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-base font-semibold tracking-tight tabular-nums">
          {estimated ? <span>{formatNumber(nowcast.estimatedStock ?? 0)}</span> : <span>{t.unavailable}</span>}
          {estimated ? (
            <InfoTooltip tone="alert" label={t.estimateAria}>
              {flat ? <FlatTip nowcast={nowcast} /> : <EstimateTip nowcast={nowcast} />}
            </InfoTooltip>
          ) : (
            <InfoTooltip label={t.unavailable}>
              <UnavailableTip nowcast={nowcast} />
            </InfoTooltip>
          )}
        </div>
        {estimated && !flat && (
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
