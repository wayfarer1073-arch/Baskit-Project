import type { EstimateConfidence, PeriodicStatus } from '@/domain/segments/periodic-count';

export const STATUS_BADGE: Record<PeriodicStatus, { label: string; variant: 'danger' | 'warning' | 'normal' | 'stagnant' }> = {
  estimated_out: { label: '추정 품절', variant: 'danger' },
  soon: { label: '품절 임박', variant: 'warning' },
  ok: { label: '여유', variant: 'normal' },
  unknown: { label: '판단 불가', variant: 'stagnant' },
};

export const CONFIDENCE_LABEL: Record<EstimateConfidence, string> = { high: '높음', medium: '보통', low: '낮음', none: '—' };
