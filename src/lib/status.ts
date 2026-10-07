import type { RiskLevel, SkuAnalysis } from '@/domain/inventory/types';

export function riskBadgeVariant(level: RiskLevel): 'danger' | 'warning' | 'normal' | 'secondary' {
  if (level === 'DANGER') return 'danger';
  if (level === 'WARNING') return 'warning';
  if (level === 'UNKNOWN') return 'secondary';
  return 'normal';
}

export type DataReliability = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

/**
 * 이 SKU의 소진량 추정이 얼마나 믿을 만한 관측 근거를 갖고 있는지 상/중/하로 나눈다.
 * analysis.forecast.confidence(operational-analysis.ts에서 계산)를 그대로 노출한다 — "자료
 * 갱신 필요"·"재고 정합성 확인" 등 추정 자체가 불가능한 사유가 있으면 예전에 쌓인 window
 * 자료가 남아있어도 무조건 하이고, 정상 추정 가능할 때만 실제로 근거로 쓴 기간(7/14/30일)으로
 * 나뉜다 — 두 번 계산해 값이 어긋나는 일이 없도록 단일 소스를 그대로 사용한다.
 */
export function dataReliabilityLevel(analysis: SkuAnalysis): DataReliability {
  // 품절·특수 관리 품목은 예측 대상이 아니라 '하'가 아닌 '제외'로 보인다.
  if (analysis.reliability?.reason === 'sold_out' || analysis.reliability?.reason === 'special') return 'NONE';
  return analysis.forecast.confidence ?? 'LOW';
}

export function dataReliabilityClassName(level: DataReliability): string {
  return level === 'HIGH' ? 'text-status-normal' : level === 'MEDIUM' ? 'text-status-warning' : level === 'NONE' ? 'text-muted-foreground' : 'text-status-danger';
}

/** "[관측 2026-09-18]" 형태의 날짜 태그인지. 화면에는 이제 신뢰도(상/중/하)로 대체해 보여주므로
 * 별도로 걸러낼 수 있게 분리했다 — 엑셀 내보내기(analysis.tags 원본)에는 그대로 남는다. */
export function isObservedDateTag(tag: string): boolean {
  return /^\[관측 \d{4}-\d{2}-\d{2}\]$/.test(tag);
}

/** 모든 행에 항상 붙던 "[입고 보정 추정·반품/조정 미분리]" 안내 태그인지. 신뢰도(상/중/하) 표시가
 * 같은 정보를 더 짧게 전달하므로 화면에서는 걸러낸다 — 엑셀 내보내기 원본에는 그대로 남는다. */
export function isEstimateCaveatTag(tag: string): boolean {
  return tag === '[입고 보정 추정·반품/조정 미분리]';
}

/** "[최근 7일 중 5출고일]" 형태의 근거 기간 태그인지. 신뢰도(상/중/하) 표시가 같은 정보를 이미
 * 전달하므로 화면에서는 걸러낸다 — 엑셀 내보내기 원본에는 그대로 남는다. */
export function isBasisWindowTag(tag: string): boolean {
  return /^\[최근 \d+일 중 \d+출고일\]$/.test(tag);
}

/** "[소비기한 확인 필요]" 태그인지. 화면에는 이 태그 대신 주황색 디데이(D-n)를 직접 보여주므로
 * 걸러낼 수 있게 분리했다 — 엑셀 내보내기 원본에는 그대로 남는다. */
export function isExpirationRiskTag(tag: string): boolean {
  return tag === '[소비기한 확인 필요]';
}

/** "[품절]" 태그인지. 상품명 옆에 이미 품절 뱃지가 뜨므로 같은 의미를 태그로 다시 보여줄 필요가
 * 없다 — 엑셀 내보내기 원본에는 그대로 남는다. */
export function isSoldOutTag(tag: string): boolean {
  return tag === '[품절]';
}

/** "[소진 미관측]" 태그인지. 재고 정체 일수 태그("[N일째 재고 변화 없음]")와 의미가 겹치므로
 * 화면에서는 걸러낸다 — 엑셀 내보내기 원본에는 그대로 남는다. */
export function isStaleDepletionTag(tag: string): boolean {
  return tag === '[소진 미관측]';
}

/** "[특수 관리 개별 판단]" 태그인지. 상품명 옆에 이미 특수 관리 뱃지가 뜨므로 같은 의미를 태그로 다시 보여줄
 * 필요가 없다 — 엑셀 내보내기 원본에는 그대로 남는다. */
export function isB2BTag(tag: string): boolean {
  return tag === '[특수 관리 개별 판단]';
}

/** 소비기한까지 남은 일수를 "D-7"/"D-DAY"/"D+3"(이미 지남) 형태로 표시한다. */
export function formatExpirationDday(daysUntilExpiration: number): string {
  if (daysUntilExpiration > 0) return `D-${daysUntilExpiration}`;
  if (daysUntilExpiration === 0) return 'D-DAY';
  return `D+${Math.abs(daysUntilExpiration)}`;
}

/**
 * SKU 행에 붙는 "[...]" 요약 태그를 물류 용어를 몰라도 바로 이해할 수 있는 짧은 문구로 바꿔서
 * 보여준다. 빠른 필터("장기 정체"·"신규 위험")와 엑셀 내보내기는 원본 태그 문자열을 그대로 매칭에
 * 쓰므로(src/lib/inventory-filters.ts, src/domain/excel/export.ts) 여기서는 화면 표시만 바꾸고
 * analysis.tags 배열 자체는 건드리지 않는다. 모르는 형태의 태그는 원문 그대로 보여준다.
 */
export function humanizeTag(tag: string): string {
  const observedMatch = tag.match(/^\[관측 (\d{4}-\d{2}-\d{2})\]$/);
  if (observedMatch) return `[${observedMatch[1]} 자료 기준]`;

  const basisMatch = tag.match(/^\[최근 (\d+)일 중 (\d+)출고일\]$/);
  if (basisMatch) return `[최근 ${basisMatch[1]}일 중 실제 자료 ${basisMatch[2]}일]`;

  const stagnantMatch = tag.match(/^\[재고 정체 (\d+)출고일\]$/);
  if (stagnantMatch) return `[${stagnantMatch[1]}일째 재고 변화 없음]`;

  const known: Record<string, string> = {
    '[입고 보정 추정·반품/조정 미분리]': '[추정치 · 반품/조정 포함 가능]',
    '[품절]': '[품절]',
    '[특수 관리 개별 판단]': '[특수 관리 재고 · 개별 확인 필요]',
    '[자료 갱신 필요]': '[최근 자료 없음]',
    '[재고 정합성 확인]': '[재고 수치 확인 필요]',
    '[입고·조정 확인]': '[입고/조정 내역 확인 필요]',
    '[관측 무재고]': '[현재 재고 없음]',
    '[관측 자료 부족]': '[판단할 자료 부족]',
    '[소진 미관측]': '[최근 변화 없음]',
    '[소비기한 확인 필요]': '[소비기한 임박]',
    '[신규 위험]': '[오늘 새로 위험 단계]',
  };
  return known[tag] ?? tag;
}

// ─── 화면 언어에 맞춘 표시(원문 한국어는 엑셀 내보내기·필터 매칭에 그대로 쓴다) ───────────────

type DomainMessages = import('@/lib/i18n/messages').Messages['domain'];

const REASON_KEYS: Record<string, keyof DomainMessages['reasons']> = {
  품절: 'soldOut',
  '특수 관리 개별 판단': 'b2b',
  '자료 갱신 필요': 'stale',
  '재고 정합성 확인': 'invalid',
  '입고·조정 확인': 'movement',
  '관측 무재고': 'noStock',
  '관측 자료 부족': 'insufficient',
  '소진 미관측': 'noUsage',
  '재고 없음': 'empty',
  '위험수량 이하': 'belowDanger',
  '경고수량 이하': 'belowWarning',
};

/** 계산이 돌려준 사유 문구(한국어)를 화면 언어로. 모르는 문구는 그대로. */
export function localizeReason(reason: string, d: DomainMessages): string {
  const key = REASON_KEYS[reason];
  return key ? d.reasons[key] : reason;
}

export function riskLabelText(level: RiskLevel, d: DomainMessages): string {
  return d.risk[level];
}

export function analysisStatusText(analysis: SkuAnalysis, d: DomainMessages): string {
  return analysis.operating?.reason ? localizeReason(analysis.operating.reason, d) : riskLabelText(analysis.thresholdRisk.level, d);
}

export function dataReliabilityText(level: DataReliability, d: DomainMessages): string {
  return d.reliability.label.replace('{level}', d.reliability[level]);
}

const TAG_KEYS: Record<string, keyof DomainMessages['tags']> = {
  '[입고 보정 추정·반품/조정 미분리]': 'estimate',
  '[품절]': 'soldOut',
  '[특수 관리 개별 판단]': 'b2b',
  '[자료 갱신 필요]': 'stale',
  '[재고 정합성 확인]': 'invalid',
  '[입고·조정 확인]': 'movement',
  '[관측 무재고]': 'noStock',
  '[관측 자료 부족]': 'insufficient',
  '[소진 미관측]': 'noUsage',
  '[소비기한 확인 필요]': 'expiry',
  '[신규 위험]': 'newRisk',
  '[재고 없음]': 'empty',
  '[위험수량 이하]': 'belowDanger',
  '[경고수량 이하]': 'belowWarning',
};

/** humanizeTag의 화면 언어 버전. 모르는 형태는 원문 그대로. */
export function humanizeTagText(tag: string, d: DomainMessages): string {
  const observed = tag.match(/^\[관측 (\d{4}-\d{2}-\d{2})\]$/);
  if (observed) return d.tags.observed.replace('{date}', observed[1]);
  const basis = tag.match(/^\[최근 (\d+)일 중 (\d+)출고일\]$/);
  if (basis) return d.tags.basis.replace('{days}', basis[1]).replace('{observed}', basis[2]);
  const stagnant = tag.match(/^\[재고 정체 (\d+)(?:출고)?일\]$/);
  if (stagnant) return d.tags.stagnant.replace('{days}', stagnant[1]);
  const key = TAG_KEYS[tag];
  return key ? d.tags[key] : tag;
}
