import { addDays, format, parseISO } from 'date-fns';
import type {
  AccelerationTrend,
  CoverageAssessment,
  CoverageBand,
  DailyDelta,
  DataMaturity,
  DepletionAcceleration,
  EffectiveRiskThresholds,
  ExpirationRiskAssessment,
  InventoryValueBreakdown,
  ManualRiskThresholds,
  OverstockCandidateInfo,
  PeriodComparison,
  RiskThresholdSettings,
  SkuAnalysis,
  StagnationInfo,
  StockObservation,
  StockoutForecast,
  ThresholdRisk,
  WindowDepletion,
} from './types';
import { DEFAULT_EXPIRATION_RISK_DAYS, DEFAULT_RISK_SETTINGS } from './types';
import { daysBetween, shiftDate } from './shipping-calendar';

/**
 * 이 모듈은 "재고 Snapshot"만으로 계산 가능한 지표만 다룬다.
 * Snapshot은 판매 데이터가 아니므로 감소량은 "추정 소진량", 증가는 "재고 증가"로만 표현하고
 * 어떤 함수도 실제 판매량을 의미하는 값을 만들어내지 않는다.
 */

function toDate(dateStr: string): Date {
  return parseISO(dateStr);
}

export function sortObservations(observations: StockObservation[]): StockObservation[] {
  return [...observations].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function dailyChange(current: StockObservation, previous: StockObservation): number {
  return current.availableStock - previous.availableStock;
}

export function dailyDepletion(current: StockObservation, previous: StockObservation): number {
  return Math.max(previous.availableStock + (current.inboundQuantity ?? 0) - current.availableStock, 0);
}

export function dailyIncrease(current: StockObservation, previous: StockObservation): number {
  return Math.max(current.availableStock - previous.availableStock - (current.inboundQuantity ?? 0), 0);
}

/** 정렬된 관측값들로부터 인접 스냅샷 간 delta 목록을 만든다 */
export function buildDailyDeltas(sortedObservations: StockObservation[]): DailyDelta[] {
  const deltas: DailyDelta[] = [];
  for (let i = 1; i < sortedObservations.length; i++) {
    const prev = sortedObservations[i - 1];
    const curr = sortedObservations[i];
    const intervalDays = daysBetween(prev.date, curr.date);
    if (intervalDays <= 0) continue; // 동일 날짜 중복 등 방어
    deltas.push({
      fromDate: prev.date,
      toDate: curr.date,
      intervalDays,
      change: dailyChange(curr, prev),
      inboundQuantity: curr.inboundQuantity ?? 0,
      depletion: dailyDepletion(curr, prev),
      increase: dailyIncrease(curr, prev),
    });
  }
  return deltas;
}

/** 두 선택일 사이의 변화를 계산한다. 선택일에 스냅샷이 없으면 해당 날짜 이전의 가장 가까운 관측치를 사용한다. */
export function calculatePeriodComparison(
  observations: StockObservation[],
  startDate: string,
  endDate: string,
): PeriodComparison | null {
  const sorted = sortObservations(observations).filter((observation) => observation.date <= endDate);
  const start = [...sorted].reverse().find((observation) => observation.date <= startDate);
  const end = sorted.at(-1);
  if (!start || !end || end.date < start.date) return null;

  const deltas = buildDailyDeltas(sorted).filter((delta) => delta.toDate > start.date && delta.toDate <= end.date);
  const observedDays = deltas.reduce((sum, delta) => sum + delta.intervalDays, 0);
  const totalDepletion = deltas.reduce((sum, delta) => sum + delta.depletion, 0);
  const totalIncrease = deltas.reduce((sum, delta) => sum + delta.increase, 0);
  const totalInboundQuantity = deltas.reduce((sum, delta) => sum + delta.inboundQuantity, 0);

  return {
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    actualStartDate: start.date,
    actualEndDate: end.date,
    startAvailableStock: start.availableStock,
    endAvailableStock: end.availableStock,
    netChange: end.availableStock - start.availableStock,
    totalDepletion,
    totalIncrease,
    totalInboundQuantity,
    observedDays,
    averageDailyDepletion: observedDays > 0 ? totalDepletion / observedDays : null,
  };
}

/**
 * asOfDate 기준 최근 windowDays 안에 "끝나는" delta들만 모아 평균 소진량을 구한다.
 * 분모는 windowDays 고정이 아니라 실제 관측된 interval 합계(observedIntervalDays)다 —
 * 스냅샷이 매일 올라오지 않는 상황을 그대로 반영하기 위함.
 */
export function calculateWindowDepletion(
  deltas: DailyDelta[],
  asOfDate: string,
  windowDays: number,
): WindowDepletion {
  // 'YYYY-MM-DD' 문자열은 사전순 비교가 날짜순과 같다.
  const windowStart = shiftDate(asOfDate, -windowDays);
  // delta의 끝(toDate)뿐 아니라 시작(fromDate)도 window 안에 있어야 한다. 그렇지 않으면
  // window보다 훨씬 긴 간격(예: 30일)의 delta가 통째로 "최근 N일" 수치에 섞여 들어간다.
  const relevant = deltas.filter((d) => d.fromDate >= windowStart && d.toDate > windowStart && d.toDate <= asOfDate);
  const totalDepletion = relevant.reduce((sum, d) => sum + d.depletion, 0);
  const totalInboundQuantity = relevant.reduce((sum, d) => sum + d.inboundQuantity, 0);
  const observedIntervalDays = relevant.reduce((sum, d) => sum + d.intervalDays, 0);
  return {
    windowDays,
    totalDepletion,
    totalInboundQuantity,
    observedIntervalDays,
    averageDailyDepletion: observedIntervalDays > 0 ? totalDepletion / observedIntervalDays : null,
  };
}

export function calculateDataMaturity(sortedObservations: StockObservation[], asOfDate: string): DataMaturity {
  if (sortedObservations.length === 0) {
    return {
      firstObservedDate: null,
      lastObservedDate: null,
      snapshotCount: 0,
      daysSinceFirstObservation: 0,
      hasDayOverDayData: false,
      hasSevenDayData: false,
      hasFourteenDayData: false,
      hasThirtyDayData: false,
    };
  }
  const first = sortedObservations[0].date;
  const last = sortedObservations[sortedObservations.length - 1].date;
  // "N일치 데이터가 있다"는 실제 관측 구간(첫 관측~마지막 관측)의 길이로 판단해야 한다.
  // asOfDate를 기준으로 하면, 마지막 업로드 이후 새 관측 없이 조회일만 흘러가도 관측이 계속
  // 쌓이고 있는 것처럼 잘못 판정된다(예: 1/1·1/2 두 건만 있는데 2/1에 조회하면 31일치로 오판).
  const observedSpanDays = daysBetween(first, last);
  const daysSinceFirstObservation = daysBetween(first, asOfDate);
  return {
    firstObservedDate: first,
    lastObservedDate: last,
    snapshotCount: sortedObservations.length,
    daysSinceFirstObservation,
    hasDayOverDayData: sortedObservations.length >= 2,
    hasSevenDayData: sortedObservations.length >= 2 && observedSpanDays >= 7,
    hasFourteenDayData: sortedObservations.length >= 2 && observedSpanDays >= 14,
    hasThirtyDayData: sortedObservations.length >= 2 && observedSpanDays >= 30,
  };
}

/** Coverage = 현재 가용재고 / 최근 일평균 추정 소진량. 소진량이 없으면 "무한대" 대신 null. */
export function calculateCoverage(
  currentAvailableStock: number,
  averageDailyDepletion: number | null,
  settings: RiskThresholdSettings = DEFAULT_RISK_SETTINGS,
): CoverageAssessment {
  if (averageDailyDepletion === null || averageDailyDepletion <= 0) {
    return { coverageDays: null, band: null };
  }
  // 가용재고가 이미 0 이하(마이너스 재고 포함)면 "N일 뒤 소진"이 아니라 이미 소진된 상태다.
  // 그대로 나누면 음수 Coverage가 나와 화면에 "-5일" 같은 값이 뜬다.
  const coverageDays = currentAvailableStock <= 0 ? 0 : currentAvailableStock / averageDailyDepletion;
  let band: CoverageBand;
  if (coverageDays <= settings.stockoutSoonDays) band = 'STOCKOUT_SOON';
  else if (coverageDays <= settings.manageMaxDays) band = 'NEEDS_MANAGEMENT';
  else band = 'HEALTHY';
  return { coverageDays, band };
}

/**
 * 예상 소진일. 최소 7일 데이터가 없으면 계산하지 않는다("데이터 축적 중").
 * 최근 데이터에 더 의미를 두어 7일 평균을 기본 근거로 쓰되, 데이터가 아직 14/30일에 못 미치면
 * 확보 가능한 가장 긴 window로 대체한다. 확정 예측이 아니라 "현재 추세 기준 예상"임을 UI가 명시해야 한다.
 */
export function selectDepletionBasis(...windows: WindowDepletion[]): WindowDepletion | null {
  return windows.find(w => w.observedIntervalDays >= 7 && w.averageDailyDepletion !== null) ?? null;
}

export function calculateStockoutForecast(
  currentAvailableStock: number,
  lastObservedDate: string,
  maturity: DataMaturity,
  window7: WindowDepletion,
  window14: WindowDepletion,
  window30: WindowDepletion,
): StockoutForecast {
  if (!maturity.hasSevenDayData) {
    return { expectedStockoutDays: null, expectedStockoutDate: null, confidence: null, basisWindowDays: 7 };
  }

  const basis = selectDepletionBasis(window7, window14, window30);
  if (!basis) return { expectedStockoutDays: null, expectedStockoutDate: null, confidence: null, basisWindowDays: 7 };
  const basisWindowDays = (basis.windowDays as 7 | 14 | 30) ?? 7;

  if (basis.averageDailyDepletion === null || basis.averageDailyDepletion <= 0) {
    return { expectedStockoutDays: null, expectedStockoutDate: null, confidence: null, basisWindowDays };
  }

  // 가용재고가 이미 0 이하면 "며칠 뒤 소진 예상"이 아니라 이미 소진된 상태다. 그대로 나누면
  // 음수가 나와 마지막 관측일보다 "과거" 날짜가 예상 소진일로 표시되는 모순이 생긴다.
  const expectedStockoutDays = currentAvailableStock <= 0 ? 0 : currentAvailableStock / basis.averageDailyDepletion;
  // 예측은 "실제로 재고를 확인한 마지막 날짜"부터 더해야 한다. asOfDate(조회일)를 기준으로 더하면
  // 새 업로드 없이 조회일만 지나가도 currentAvailableStock을 조회일 시점 값처럼 착각해 예상
  // 소진일이 매일 뒤로 밀린다.
  const expectedStockoutDate = format(addDays(toDate(lastObservedDate), Math.round(expectedStockoutDays)), 'yyyy-MM-dd');

  const confidence = calculateConfidence(maturity, window7, window14);

  return { expectedStockoutDays, expectedStockoutDate, confidence, basisWindowDays };
}

/**
 * 단순 설명 가능한 신뢰도 휴리스틱(블랙박스 모델 아님):
 * - 데이터 기간이 길수록 신뢰도 ↑
 * - 최근 7일과 14일 평균 소진 변동성이 크면(변화율 큼) 신뢰도 ↓
 */
export function calculateConfidence(
  maturity: DataMaturity,
  window7: WindowDepletion,
  window14: WindowDepletion,
): 'LOW' | 'MEDIUM' | 'HIGH' {
  // 스냅샷은 실제 출고·반품·조정을 구분하지 못한다. 보정된 예측 정확도로 오인할 HIGH는 부여하지 않는다.
  const r7 = window7.averageDailyDepletion;
  const r14 = window14.averageDailyDepletion;
  return maturity.snapshotCount >= 15 && window7.observedIntervalDays >= 7
    && window14.observedIntervalDays >= 14 && r7 !== null && r14 !== null && r14 > 0
    && Math.abs(r7 / r14 - 1) < 0.6 ? 'MEDIUM' : 'LOW';
}

/** 소진 가속/둔화: 최소 14일 데이터 필요 */
export function calculateAcceleration(maturity: DataMaturity, deltas: DailyDelta[], asOfDate: string): DepletionAcceleration {
  if (!maturity.hasFourteenDayData) {
    return { recent7AvgDepletion: null, previous7AvgDepletion: null, accelerationRatePercent: null, trend: null };
  }
  const recent7 = calculateWindowDepletion(deltas, asOfDate, 7);
  const eightDaysAgo = shiftDate(asOfDate, -7);
  const previous7 = calculateWindowDepletion(deltas, eightDaysAgo, 7);

  if (recent7.observedIntervalDays < 7 || previous7.observedIntervalDays < 7) {
    return { recent7AvgDepletion: null, previous7AvgDepletion: null, accelerationRatePercent: null, trend: null };
  }
  const recentAvg = recent7.averageDailyDepletion;
  const prevAvg = previous7.averageDailyDepletion;

  let trend: AccelerationTrend = 'STABLE';
  let rate: number | null = null;

  if (recentAvg === null || prevAvg === null) {
    trend = null;
  } else if (prevAvg === 0) {
    trend = recentAvg > 0 ? 'NEW_DEPLETION' : 'STABLE';
  } else {
    rate = (recentAvg / prevAvg - 1) * 100;
    if (rate >= 20) trend = 'ACCELERATING';
    else if (rate <= -20) trend = 'DECELERATING';
    else trend = 'STABLE';
  }

  return { recent7AvgDepletion: recentAvg, previous7AvgDepletion: prevAvg, accelerationRatePercent: rate, trend };
}

/**
 * 위험/경고수량의 유효값을 우선순위에 따라 해석한다: 관리자가 SKU 상세에서 직접 지정한 값
 * (manual) > 업로드가 제공한 스냅샷 값(legacy, 0 초과일 때만) > 최근 7일 평균 소진량을
 * 설정된 기준일수로 역산한 자동계산(auto) 순. 아무 근거도 없으면 위험 판정을 하지 않는다(none).
 *
 * "최소 업로드 양식"으로 전환되면서 Excel이 더 이상 경고수량/위험수량을 제공하지 않아
 * legacy 값이 항상 0이 되고, 자동계산 없이는 모든 SKU가 영구히 "정상"으로만 표시되는
 * 문제가 있었다 — auto 단계가 바로 그 문제를 메꾼다.
 */
export function resolveEffectiveThresholds(
  latest: Pick<StockObservation, 'dangerQty' | 'warningQty'>,
  manual: ManualRiskThresholds | null | undefined,
  avgDailyDepletion: number | null,
  settings: RiskThresholdSettings = DEFAULT_RISK_SETTINGS,
): EffectiveRiskThresholds {
  const manualDangerQty = manual?.dangerQty ?? null;
  const manualWarningQty = manual?.warningQty ?? null;
  if (manualDangerQty !== null || manualWarningQty !== null) {
    const fallback = resolveEffectiveThresholds(latest, null, avgDailyDepletion, settings);
    return { dangerQty: manualDangerQty ?? fallback.dangerQty, warningQty: manualWarningQty ?? fallback.warningQty, source: 'manual' };
  }
  if (latest.dangerQty > 0 || latest.warningQty > 0) {
    return { dangerQty: latest.dangerQty, warningQty: latest.warningQty, source: 'legacy' };
  }
  if (avgDailyDepletion !== null && avgDailyDepletion > 0) {
    return {
      dangerQty: Math.round(avgDailyDepletion * settings.stockoutSoonDays),
      warningQty: Math.round(avgDailyDepletion * settings.manageMaxDays),
      source: 'auto',
    };
  }
  return { dangerQty: 0, warningQty: 0, source: 'none' };
}

/** Excel의 위험수량/경고수량을 우선 적용하는 기본 위험 판정 */
export function calculateThresholdRisk(observation: StockObservation): ThresholdRisk {
  if (observation.availableStock <= 0) return { level: 'DANGER', reason: '재고 없음' };
  if (observation.dangerQty > 0 && observation.availableStock <= observation.dangerQty) {
    return { level: 'DANGER', reason: '위험수량 이하' };
  }
  if (observation.warningQty > 0 && observation.availableStock <= observation.warningQty) {
    return { level: 'WARNING', reason: '경고수량 이하' };
  }
  return { level: 'NORMAL', reason: null };
}

/** 장기 정체: 마지막 소진(daily_depletion > 0) 이후 경과일. 30일 데이터 쌓이기 전엔 의미 없음 */
export function calculateStagnation(
  sortedObservations: StockObservation[],
  deltas: DailyDelta[],
  asOfDate: string,
  maturity: DataMaturity,
): StagnationInfo {
  if (sortedObservations.length === 0) {
    return { lastDepletionDate: null, stagnantDays: 0, isMeaningful: false };
  }
  let lastDepletionDate: string | null = null;
  for (let i = deltas.length - 1; i >= 0; i--) {
    if (deltas[i].depletion > 0) {
      lastDepletionDate = deltas[i].toDate;
      break;
    }
  }
  const anchorDate = lastDepletionDate ?? sortedObservations[0].date;
  const lastObservedDate = sortedObservations[sortedObservations.length - 1].date;
  const stagnantDays = daysBetween(anchorDate, lastObservedDate < asOfDate ? lastObservedDate : asOfDate);
  return { lastDepletionDate, stagnantDays, isMeaningful: maturity.hasThirtyDayData };
}

/** 과잉재고 후보: 30일 데이터 필요, 30일 평균 소진 기준 coverage가 임계값 이상이면 "후보"로만 표시 */
export function calculateOverstockCandidate(
  currentAvailableStock: number,
  window30: WindowDepletion,
  maturity: DataMaturity,
  settings: RiskThresholdSettings = DEFAULT_RISK_SETTINGS,
): OverstockCandidateInfo {
  if (!maturity.hasThirtyDayData || window30.observedIntervalDays < 30 || window30.averageDailyDepletion === null || window30.averageDailyDepletion <= 0) {
    return { isCandidate: false, coverageDays: null, thresholdDays: settings.overstockCoverageDays };
  }
  // Coverage와 동일한 이유로 음수 가용재고를 방어한다 — 그대로 나누면 음수 coverageDays가 나온다.
  const coverageDays = currentAvailableStock <= 0 ? 0 : currentAvailableStock / window30.averageDailyDepletion;
  return {
    isCandidate: coverageDays >= settings.overstockCoverageDays,
    coverageDays,
    thresholdDays: settings.overstockCoverageDays,
  };
}

/**
 * 소비기한과 Coverage(예상 소진일수)를 비교해 "다 팔기 전에 소비기한을 넘길 위험"을 판정한다.
 * "위험 판정일" = 소비기한 - riskDays로 안전 여유를 두고, 그날까지 남은 일수보다 Coverage가
 * 더 길면(=지금 속도로는 그 안에 다 못 판다는 뜻) 위험으로 본다.
 */
export function calculateExpirationRisk(
  expirationDate: string | null,
  riskDays: number | null,
  coverageDays: number | null,
  asOfDate: string,
  currentStock?: number,
): ExpirationRiskAssessment {
  if (!expirationDate) {
    return { expirationDate: null, riskDays: null, daysUntilExpiration: null, daysUntilRiskDate: null, isAtRisk: false };
  }
  const effectiveRiskDays = riskDays ?? DEFAULT_EXPIRATION_RISK_DAYS;
  const daysUntilExpiration = daysBetween(asOfDate, expirationDate);
  const daysUntilRiskDate = daysUntilExpiration - effectiveRiskDays;
  const isAtRisk = currentStock !== undefined && currentStock <= 0 ? false
    : (currentStock !== undefined && currentStock > 0 && daysUntilRiskDate <= 0)
      || (coverageDays !== null && coverageDays > daysUntilRiskDate);
  return { expirationDate, riskDays: effectiveRiskDays, daysUntilExpiration, daysUntilRiskDate, isAtRisk };
}

const RISK_RANK = { UNKNOWN: -1, NORMAL: 0, WARNING: 1, DANGER: 2 } as const;

function coverageBandLabel(band: CoverageBand): string | null {
  if (band === 'STOCKOUT_SOON') return '품절 임박';
  if (band === 'NEEDS_MANAGEMENT') return '관리 필요';
  return null;
}

/** 한 SKU의 전체 분석 결과를 조립한다. 서버 레이어에서 관측 시계열을 조회해 이 함수에 넘긴다. */
export function analyzeSku(
  observations: StockObservation[],
  asOfDate: string,
  settings: RiskThresholdSettings = DEFAULT_RISK_SETTINGS,
  manualThresholds?: ManualRiskThresholds | null,
  expirationConfig?: { expirationDate: string | null; expirationRiskDays: number | null } | null,
): SkuAnalysis | null {
  const sorted = sortObservations(observations.filter((o) => o.date <= asOfDate));
  if (sorted.length === 0) return null;

  const latest = sorted[sorted.length - 1];
  const previous = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
  const deltas = buildDailyDeltas(sorted);
  const maturity = calculateDataMaturity(sorted, asOfDate);

  const window7 = calculateWindowDepletion(deltas, latest.date, 7);
  const window14 = calculateWindowDepletion(deltas, latest.date, 14);
  const window30 = calculateWindowDepletion(deltas, latest.date, 30);
  const basis = selectDepletionBasis(window7, window14, window30);

  const coverage = maturity.hasSevenDayData && basis
    ? calculateCoverage(latest.availableStock, basis.averageDailyDepletion, settings)
    : { coverageDays: null, band: null };
  const forecast = calculateStockoutForecast(latest.availableStock, latest.date, maturity, window7, window14, window30);
  const acceleration = calculateAcceleration(maturity, deltas, latest.date);
  const riskThresholds = resolveEffectiveThresholds(latest, manualThresholds, basis?.averageDailyDepletion ?? null, settings);
  const effectiveLatest = { ...latest, dangerQty: riskThresholds.dangerQty, warningQty: riskThresholds.warningQty };
  const thresholdRisk = calculateThresholdRisk(effectiveLatest);
  const stagnation = calculateStagnation(sorted, deltas, asOfDate, maturity);
  const overstock = calculateOverstockCandidate(latest.availableStock, window30, maturity, settings);
  const expirationRisk = calculateExpirationRisk(
    expirationConfig?.expirationDate ?? null,
    expirationConfig?.expirationRiskDays ?? null,
    coverage.coverageDays === null ? null : Math.max(0, coverage.coverageDays - daysBetween(latest.date, asOfDate)),
    asOfDate,
    latest.normalStock,
  );

  const dailyChangeValue = previous ? dailyChange(latest, previous) : null;
  const latestDelta = deltas.at(-1);
  const stockIncreasedToday = latestDelta?.toDate === latest.date && latestDelta.increase > 0;

  const tags: string[] = [];
  if (latest.date < asOfDate) tags.push(`[재고 관측일 ${latest.date}]`);
  if (thresholdRisk.reason) tags.push(`[${thresholdRisk.reason}]`);
  if (coverage.band) {
    const label = coverageBandLabel(coverage.band);
    if (label && coverage.coverageDays !== null) tags.push(`[${label} · ${Math.floor(coverage.coverageDays)}일분]`);
  }
  if (acceleration.trend === 'ACCELERATING' && acceleration.accelerationRatePercent !== null) {
    tags.push(`[소진속도 +${Math.round(acceleration.accelerationRatePercent)}%]`);
  } else if (acceleration.trend === 'DECELERATING' && acceleration.accelerationRatePercent !== null) {
    tags.push(`[소진속도 ${Math.round(acceleration.accelerationRatePercent)}%]`);
  } else if (acceleration.trend === 'NEW_DEPLETION') {
    tags.push('[신규 소진 발생]');
  }
  if (stagnation.isMeaningful && stagnation.stagnantDays >= settings.stagnantDays) {
    tags.push(`[재고 정체 ${stagnation.stagnantDays}일]`);
  }
  if (expirationRisk.isAtRisk) tags.push('[소비기한 임박 위험]');
  if (overstock.isCandidate) tags.push('[과잉재고 후보]');
  if ((latest.inboundQuantity ?? 0) > 0) tags.push(`[입고 ${latest.inboundQuantity}개 반영]`);
  if (stockIncreasedToday) tags.push('[재고 증가 감지]');
  // 전일 위험도는 과거 시점의 소진 속도를 다시 역산하지 않고, 오늘과 동일한 유효 임계값을
  // 전일 가용재고에 적용해 비교한다(임계값이 하루 사이 크게 바뀌지 않는다는 전제로 충분히 정확하고,
  // 매 비교마다 과거 시점 window를 다시 계산하는 비용을 피한다).
  const previousThresholdRisk = previous ? calculateThresholdRisk({ ...previous, dangerQty: riskThresholds.dangerQty, warningQty: riskThresholds.warningQty }) : null;
  const newlyAtRisk = previousThresholdRisk !== null && RISK_RANK[thresholdRisk.level] > RISK_RANK[previousThresholdRisk.level];
  if (newlyAtRisk) tags.push('[신규 위험]');

  return {
    asOfDate,
    latest,
    previous,
    dailyChange: dailyChangeValue,
    maturity,
    window7,
    window14,
    window30,
    coverage,
    forecast,
    acceleration,
    thresholdRisk,
    riskThresholds,
    expirationRisk,
    stagnation,
    overstock,
    tags,
    stockIncreasedToday,
    newlyAtRisk,
  };
}

/** 오늘 새롭게 위험/주의 단계로 악화된 SKU인지("어제 정상 → 오늘 주의/위험" 등). tags에도 '[신규 위험]'으로 반영됨 */
export function isNewlyAtRisk(analysis: SkuAnalysis): boolean {
  return analysis.newlyAtRisk;
}

/** 업로드 원가합을 우선하고, 없으면 정상재고 × 유효 단위원가를 사용한다. */
export function calculateInventoryValue(observation: Pick<StockObservation, 'normalStock' | 'unitCost' | 'totalCost'>): number {
  return observation.totalCost ?? observation.normalStock * observation.unitCost;
}

export function calculateInventoryValueBreakdown(
  observation: Pick<StockObservation, 'normalStock' | 'availableStock' | 'defectiveStock' | 'incomingStock' | 'unitCost' | 'totalCost'>,
): InventoryValueBreakdown {
  return {
    normalStockValue: calculateInventoryValue(observation),
    availableStockValue: observation.availableStock * observation.unitCost,
    defectiveStockValue: observation.defectiveStock * observation.unitCost,
    incomingStockValue: observation.incomingStock * observation.unitCost,
  };
}
