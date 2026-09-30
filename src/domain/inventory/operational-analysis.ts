import { differenceInCalendarDays, parseISO } from 'date-fns';
import { analyzeSku, buildDailyDeltas, calculateCoverage, calculateThresholdRisk, resolveEffectiveThresholds } from './calculations';
import { demandDaysBetween, latestShippingDay, NO_HOLIDAYS, shiftDate, shippingDateAfter, shippingDaysBetween } from './shipping-calendar';
import type { DailyDelta, ManualRiskThresholds, RiskThresholdSettings, SkuAnalysis, StockObservation, WindowDepletion } from './types';
import { DEFAULT_EXPIRATION_RISK_DAYS, DEFAULT_RISK_SETTINGS } from './types';
import { assessReliability } from '@/domain/reliability/reliability';

/** 매일 받는 재고 파일은 출고일 3일만 밀려도 믿기 어려워진다. */
const DAILY_HALF_LIFE_SHIPPING_DAYS = 3;

export interface OperatingContext {
  holidays?: ReadonlySet<string>;
  isB2B?: boolean;
  isMissing?: boolean;
}

interface ShippingWindow extends WindowDepletion {
  intervalCount: number;
  longestGap: number;
  unexplainedIncrease: number;
  inconsistent: boolean;
}

/**
 * Last N calendar days, normalized by demand days (shipping days + weekday holidays), never by upload count.
 * 휴무 동안 쌓인 주문은 휴무 뒤 첫 출고일 재고에서 한꺼번에 빠지므로, 그 감소량을 출고일 수로만 나누면 소진 속도가
 * 부풀고 커버리지가 과소평가된다 — 분모에 평일 휴무일을 포함한다. 업로드 간격(longestGap)은 자료가 빠졌는지를
 * 보는 값이라 실제 출고일 기준 그대로 둔다(긴 연휴 뒤에도 관측 자료 부족으로 떨어지지 않도록).
 */
function shippingWindow(deltas: DailyDelta[], end: string, days: number, holidays: ReadonlySet<string>): ShippingWindow {
  const relevant = deltas.filter((d) => d.fromDate >= shiftDate(end, -days) && d.toDate <= end);
  let observedIntervalDays = 0,
    totalDepletion = 0,
    totalInboundQuantity = 0,
    intervalCount = 0,
    longestGap = 0,
    unexplainedIncrease = 0;
  let inconsistent = false;
  for (const d of relevant) {
    const span = demandDaysBetween(d.fromDate, d.toDate, holidays);
    if (span === 0) {
      if (d.depletion > 0 || d.increase > 0) inconsistent = true;
      continue;
    }
    observedIntervalDays += span;
    totalDepletion += d.depletion;
    totalInboundQuantity += d.inboundQuantity;
    unexplainedIncrease += d.increase;
    longestGap = Math.max(longestGap, shippingDaysBetween(d.fromDate, d.toDate, holidays));
    intervalCount++;
  }
  return {
    windowDays: days,
    observedIntervalDays,
    totalDepletion,
    totalInboundQuantity,
    intervalCount,
    longestGap,
    unexplainedIncrease,
    inconsistent,
    averageDailyDepletion: observedIntervalDays ? totalDepletion / observedIntervalDays : null,
  };
}

/** Shipping-day analysis used by the app. Legacy calendar primitives remain independently testable. */
export function analyzeOperationalSku(
  observations: StockObservation[],
  asOfDate: string,
  settings: RiskThresholdSettings = DEFAULT_RISK_SETTINGS,
  manual?: ManualRiskThresholds | null,
  expiry?: { expirationDate: string | null; expirationRiskDays: number | null } | null,
  context: OperatingContext = {},
): SkuAnalysis | null {
  const base = analyzeSku(observations, asOfDate, settings, manual, expiry);
  if (!base) return null;
  const holidays = context.holidays ?? NO_HOLIDAYS;
  const sorted = observations.filter((o) => o.date <= asOfDate).sort((a, b) => a.date.localeCompare(b.date));
  const { latest, previous } = base;
  const deltas = buildDailyDeltas(sorted);
  const windows = [7, 14, 30].map((days) => shippingWindow(deltas, latest.date, days, holidays));
  const [w7, w14, w30] = windows;
  // Five shipping days and at least three intervals guard against newly introduced or sparse SKUs.
  const basis = windows.find((w) => w.observedIntervalDays >= 5 && w.intervalCount >= 3 && w.longestGap <= 3) ?? null;
  const staleDays = shippingDaysBetween(latest.date, latestShippingDay(asOfDate, holidays), holidays);
  const invalid = sorted.some((o) => o.date >= shiftDate(latest.date, -30) && o.normalStock < 0);
  const uncertainMovement = !!basis && (basis.inconsistent || basis.unexplainedIncrease > 0);
  const reason = context.isMissing
    ? '품절'
    : context.isB2B
      ? '특수 관리 개별 판단'
      : staleDays > 0
        ? '자료 갱신 필요'
        : invalid
          ? '재고 정합성 확인'
          : uncertainMovement
            ? '입고·조정 확인'
            : latest.normalStock === 0
              ? '관측 무재고'
              : !basis
                ? '관측 자료 부족'
                : basis.averageDailyDepletion === 0
                  ? '소진 미관측'
                  : null;
  const canEstimate = reason === null;
  // 추정을 막는 사유가 있으면 예전 근거 기간이 멀쩡해 보여도 무조건 '하'다(assessReliability가 보장).
  const reliabilityWindow = basis ?? w7;
  const reliability = assessReliability({
    source: sorted[sorted.length - 1]?.source === 'COUNT' ? 'COUNT' : 'SNAPSHOT',
    expectedDays: demandDaysBetween(shiftDate(latest.date, -reliabilityWindow.windowDays), latest.date, holidays),
    observedDays: reliabilityWindow.observedIntervalDays,
    windowDays: reliabilityWindow.windowDays,
    intervals: reliabilityWindow.intervalCount,
    minIntervals: 3,
    daysSinceLevel: staleDays,
    halfLifeDays: DAILY_HALF_LIFE_SHIPPING_DAYS,
    blockingReason: reason,
  });
  const confidence = reliability.level;
  const rate = canEstimate ? basis!.averageDailyDepletion : null;
  const coverage = calculateCoverage(latest.normalStock, rate, settings);
  // 커버리지는 수요일(평일, 휴무 포함) 단위이므로 앞으로의 휴무일도 주문이 쌓이는 날로 센다 — 연휴 직후 품절을 놓치지 않도록.
  const stockoutDate = coverage.coverageDays === null ? null : shippingDateAfter(latest.date, coverage.coverageDays);
  const thresholds = resolveEffectiveThresholds(latest, manual, rate, settings);
  let thresholdRisk = calculateThresholdRisk({ ...latest, dangerQty: thresholds.dangerQty, warningQty: thresholds.warningQty });
  const manualKnown = thresholds.source === 'manual' || thresholds.source === 'legacy';
  if (context.isMissing || context.isB2B || staleDays > 0 || invalid || uncertainMovement || (latest.normalStock > 0 && !canEstimate && !manualKnown)) {
    thresholdRisk = { level: 'UNKNOWN', reason: null };
  }
  const p7 = shippingWindow(deltas, shiftDate(latest.date, -7), 7, holidays);
  const expected7 = demandDaysBetween(shiftDate(latest.date, -7), latest.date, holidays);
  const expectedP7 = demandDaysBetween(shiftDate(latest.date, -14), shiftDate(latest.date, -7), holidays);
  const comparable =
    (canEstimate || reason === '소진 미관측') &&
    expected7 > 0 &&
    expectedP7 > 0 &&
    w7.observedIntervalDays === expected7 &&
    p7.observedIntervalDays === expectedP7 &&
    w7.intervalCount >= 3 &&
    p7.intervalCount >= 3 &&
    !p7.inconsistent &&
    p7.unexplainedIncrease === 0;
  const acceleration: SkuAnalysis['acceleration'] = { recent7AvgDepletion: null, previous7AvgDepletion: null, accelerationRatePercent: null, trend: null };
  if (comparable) {
    acceleration.recent7AvgDepletion = w7.averageDailyDepletion;
    acceleration.previous7AvgDepletion = p7.averageDailyDepletion;
    const recent = w7.averageDailyDepletion!,
      prior = p7.averageDailyDepletion!;
    if (prior === 0) acceleration.trend = recent > 0 ? 'NEW_DEPLETION' : 'STABLE';
    else {
      const change = (recent / prior - 1) * 100;
      acceleration.accelerationRatePercent = change;
      acceleration.trend = change >= 20 ? 'ACCELERATING' : change <= -20 ? 'DECELERATING' : 'STABLE';
    }
  }
  const lastDecrease = [...deltas].reverse().find((d) => d.depletion > 0)?.toDate ?? null;
  const stagnantDays = shippingDaysBetween(lastDecrease ?? sorted[0].date, latest.date, holidays);
  const observedSpan = shippingDaysBetween(sorted[0].date, latest.date, holidays);
  const stagnation = {
    lastDepletionDate: lastDecrease,
    stagnantDays,
    isMeaningful:
      latest.normalStock > 0 &&
      !context.isMissing &&
      !context.isB2B &&
      staleDays === 0 &&
      !invalid &&
      !uncertainMovement &&
      observedSpan >= settings.stagnantDays &&
      sorted.length >= 4,
  };
  const overstockCoverage =
    canEstimate &&
    w30.observedIntervalDays >= 15 &&
    w30.intervalCount >= 10 &&
    !w30.inconsistent &&
    w30.unexplainedIncrease === 0 &&
    w30.longestGap <= 3 &&
    w30.averageDailyDepletion! > 0
      ? Math.max(latest.normalStock, 0) / w30.averageDailyDepletion!
      : null;
  const expirationDate = expiry?.expirationDate ?? null;
  const riskDays = expiry?.expirationRiskDays ?? DEFAULT_EXPIRATION_RISK_DAYS;
  const daysUntilExpiration = expirationDate ? differenceInCalendarDays(parseISO(expirationDate), parseISO(asOfDate)) : null;
  const riskDate = expirationDate ? shiftDate(expirationDate, -riskDays) : null;
  // Expiration is a calendar date, never compare it directly with shipping-day coverage.
  // Lot quantities are unknown: flag a date to inspect, not a quantity expected to expire.
  const expirationRisk = {
    expirationDate,
    riskDays: expirationDate ? riskDays : null,
    daysUntilExpiration,
    daysUntilRiskDate: daysUntilExpiration === null ? null : daysUntilExpiration - riskDays,
    isAtRisk: !context.isMissing && latest.normalStock > 0 && riskDate !== null && (riskDate <= asOfDate || (stockoutDate !== null && stockoutDate > riskDate)),
  };
  const newlyAtRisk =
    canEstimate && previous !== null && thresholdRisk.level !== 'UNKNOWN' && previous.normalStock > thresholds.warningQty && latest.normalStock <= thresholds.warningQty;
  const tags = [`[관측 ${latest.date}]`, '[입고 보정 추정·반품/조정 미분리]'];
  if (reason) tags.push(`[${reason}]`);
  if (basis && !context.isB2B && !context.isMissing) tags.push(`[최근 ${basis.windowDays}일 중 ${basis.observedIntervalDays}출고일]`);
  if (stagnation.isMeaningful && stagnantDays >= settings.stagnantDays) tags.push(`[재고 정체 ${stagnantDays}출고일]`);
  if (expirationRisk.isAtRisk) tags.push('[소비기한 확인 필요]');
  if (newlyAtRisk) tags.push('[신규 위험]');
  const displayWindow = (w: ShippingWindow): WindowDepletion => ({
    ...w,
    averageDailyDepletion: context.isB2B || context.isMissing || invalid || w.inconsistent ? null : w.averageDailyDepletion,
  });
  return {
    ...base,
    window7: displayWindow(w7),
    window14: displayWindow(w14),
    window30: displayWindow(w30),
    coverage,
    forecast: { expectedStockoutDays: coverage.coverageDays, expectedStockoutDate: stockoutDate, basisWindowDays: (basis?.windowDays ?? 7) as 7 | 14 | 30, confidence },
    acceleration,
    thresholdRisk,
    riskThresholds: thresholds,
    stagnation,
    overstock: {
      isCandidate: overstockCoverage !== null && overstockCoverage >= settings.overstockCoverageDays,
      coverageDays: overstockCoverage,
      thresholdDays: settings.overstockCoverageDays,
    },
    expirationRisk,
    newlyAtRisk,
    tags,
    reliability,
    operating: {
      reason,
      isB2B: !!context.isB2B,
      isMissing: !!context.isMissing,
      staleShippingDays: staleDays,
      basisWindowDays: basis?.windowDays ?? null,
      observedShippingDays: basis?.observedIntervalDays ?? 0,
      unexplainedIncrease: w30.unexplainedIncrease,
      intervalCount: basis?.intervalCount ?? 0,
    },
  };
}
