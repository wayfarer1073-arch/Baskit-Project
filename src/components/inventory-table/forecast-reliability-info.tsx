'use client';

import type { ForecastReliability } from '@/domain/inventory/nowcast';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

/** 일일 업로드 품목의 신뢰도 근거 — 몇 일 앞을 몇 번 되짚어 얼마나 틀렸는지, 등급 기준, 등급을 못 매긴 사유. */
export function ForecastReliabilityInfo({ reliability, className }: { reliability: ForecastReliability | null | undefined; className?: string }) {
  const { m } = useI18n();
  if (!reliability) return null;
  const t = m.dashboard.nowcast.reliabilityInfo;
  const reasons = m.dashboard.nowcast.reasons;
  const error = reliability.backtest ? (reliability.backtest.wape * 100).toFixed(1) : '—';
  const excluded = reliability.reason === 'sold_out' || reliability.reason === 'special';
  return (
    <InfoTooltip className={className}>
      <div className="space-y-1">
        <div className="font-semibold">{format(t.title, { level: m.domain.reliability[excluded ? 'NONE' : reliability.level] })}</div>
        {reliability.backtest && !reliability.reason && <p>{format(t.body, { horizon: reliability.horizon, origins: reliability.backtest.origins, error })}</p>}
        {reliability.pattern === 'intermittent' && !excluded && <p>{t.intermittent}</p>}
        {reliability.reason === 'no_depletion' && <p>{t.noDepletion}</p>}
        {reliability.reason && reliability.reason !== 'no_depletion' && <p>{format(reasons[reliability.reason], { error })}</p>}
        <p className="opacity-75">{t.scale}</p>
        <p className="opacity-75">{t.basis}</p>
      </div>
    </InfoTooltip>
  );
}
