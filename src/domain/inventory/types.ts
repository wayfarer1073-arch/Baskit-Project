/** 재고 도메인 공용 타입. 전부 순수 데이터 — DB/Prisma 타입과 분리해 계산 로직을 테스트하기 쉽게 유지한다. */

/** 특정 SKU의 특정 기준일 스냅샷 관측값 (날짜는 'YYYY-MM-DD', KST 달력 기준) */
export interface StockObservation {
  date: string;
  /** 이 재고 수준의 출처 — 외부 재고현황 파일(SNAPSHOT)인지, 사람이 직접 센 실사(COUNT)인지. 없으면 SNAPSHOT. */
  source?: 'SNAPSHOT' | 'COUNT';
  /** 이전 스냅샷 이후 이 스냅샷까지 실제 입고된 것으로 사용자가 기록한 수량 */
  inboundQuantity?: number;
  availableStock: number;
  normalStock: number;
  defectiveStock: number;
  incomingStock: number;
  unitCost: number;
  /** 업로드 원가합 또는 유효 원가 × 정상재고로 보정한 재고자산 */
  totalCost?: number;
  /** 원가 미상과 명시적 0원을 구분한다. */
  valuationKnown?: boolean;
  warningQty: number;
  dangerQty: number;
}

/** 인접한 두 스냅샷 사이의 변화. interval은 두 스냅샷 간 실제 경과일수(업로드 누락 등으로 1일보다 클 수 있음) */
export interface DailyDelta {
  fromDate: string;
  toDate: string;
  intervalDays: number;
  change: number; // current - previous (부호 있음)
  inboundQuantity: number;
  depletion: number; // max(previous + inbound - current, 0)
  increase: number; // max(current - previous - inbound, 0): 입고로 설명되지 않는 증가
}

/** 특정 window(예: 7/14/30일)에 대한 평균 소진량 계산 결과 */
export interface WindowDepletion {
  windowDays: number;
  /** 총 소진량 합계 */
  totalDepletion: number;
  /** window 안에서 사용자가 입력한 입고 특이사항 합계 */
  totalInboundQuantity?: number;
  /** 실제로 관측된 interval의 합계 일수(스냅샷이 매일 올라오지 않을 수 있어 windowDays와 다를 수 있음) */
  observedIntervalDays: number;
  /** totalDepletion / observedIntervalDays. 관측 interval이 없으면 null */
  averageDailyDepletion: number | null;
}

export interface DataMaturity {
  firstObservedDate: string | null;
  lastObservedDate: string | null;
  snapshotCount: number;
  /** firstObservedDate ~ asOfDate 경과일수 */
  daysSinceFirstObservation: number;
  hasDayOverDayData: boolean; // >= 2 snapshots
  hasSevenDayData: boolean; // >= 7 days span
  hasFourteenDayData: boolean; // >= 14 days span
  hasThirtyDayData: boolean; // >= 30 days span
}

export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface StockoutForecast {
  /** 데이터 축적 기간 부족(7일 미만)이면 null이고 UI는 "데이터 축적 중" 표시 */
  expectedStockoutDays: number | null;
  expectedStockoutDate: string | null;
  confidence: ConfidenceLevel | null;
  basisWindowDays: 7 | 14 | 30;
}

export type AccelerationTrend = 'ACCELERATING' | 'DECELERATING' | 'STABLE' | 'NEW_DEPLETION' | null;

export interface DepletionAcceleration {
  recent7AvgDepletion: number | null;
  previous7AvgDepletion: number | null;
  /** (recent7/previous7 - 1) * 100. previous7이 0이면 null이고 trend로 별도 표기 */
  accelerationRatePercent: number | null;
  trend: AccelerationTrend;
}

export type RiskLevel = 'DANGER' | 'WARNING' | 'NORMAL' | 'UNKNOWN';

/** Excel의 위험수량/경고수량 기준 (우선 적용 규칙) */
export interface ThresholdRisk {
  level: RiskLevel;
  reason: '재고 없음' | '위험수량 이하' | '경고수량 이하' | null;
}

/**
 * 위험/경고수량의 출처.
 * - manual: SKU 상세에서 관리자가 직접 지정
 * - legacy: 업로드(Excel 등)가 제공한 스냅샷 값(0 초과)
 * - auto: 최소 7일이 관측된 구간의 소진 속도 × 설정된 기준일수로 역산
 * - none: 임계값 판정 근거 없음. 무재고는 별도 위험 판정.
 */
export type RiskThresholdSource = 'manual' | 'legacy' | 'auto' | 'none';

export interface EffectiveRiskThresholds {
  dangerQty: number;
  warningQty: number;
  source: RiskThresholdSource;
}

/** SKU 상세에서 관리자가 직접 지정한 값. 필드별로 null이면 그 필드만 자동계산으로 대체된다. */
export interface ManualRiskThresholds {
  dangerQty: number | null;
  warningQty: number | null;
}

/** SKU별 소비기한 위험 판정 일수를 따로 지정하지 않았을 때 쓰는 기본값 */
export const DEFAULT_EXPIRATION_RISK_DAYS = 14;

/**
 * 소비기한과 Coverage(예상 소진일수)를 비교한 결과. "위험 판정일"(=소비기한 - riskDays)까지
 * 남은 일수보다 Coverage가 더 길면, 그 시점까지 다 팔지 못하고 소비기한을 넘길 위험이 있다고 본다.
 */
export interface ExpirationRiskAssessment {
  expirationDate: string | null;
  /** 실제로 판정에 쓰인 값(SKU 설정이 없으면 DEFAULT_EXPIRATION_RISK_DAYS) */
  riskDays: number | null;
  daysUntilExpiration: number | null;
  /** 소비기한 - riskDays 시점까지 남은 일수. 이미 지났으면 음수 */
  daysUntilRiskDate: number | null;
  isAtRisk: boolean;
}

export type CoverageBand = 'STOCKOUT_SOON' | 'NEEDS_MANAGEMENT' | 'HEALTHY' | null;

export interface CoverageAssessment {
  /** 소진량이 0이거나 관측이 부족하면 null. UI는 "산정 불가" 표시 */
  coverageDays: number | null;
  band: CoverageBand;
}

export interface StagnationInfo {
  /** 마지막으로 daily_depletion > 0이 관측된 날짜. 한 번도 감소가 없었다면 firstObservedDate */
  lastDepletionDate: string | null;
  stagnantDays: number;
  /** 30일 이상 데이터가 쌓이기 전에는 의미 없는 값이므로 null */
  isMeaningful: boolean;
}

export interface OverstockCandidateInfo {
  isCandidate: boolean;
  /** 판단에 사용한 coverage (30일 평균 소진 기준) */
  coverageDays: number | null;
  thresholdDays: number;
}

export interface RiskThresholdSettings {
  stockoutSoonDays: number;
  manageMaxDays: number;
  overstockCoverageDays: number;
  stagnantDays: number;
}

export const DEFAULT_RISK_SETTINGS: RiskThresholdSettings = {
  stockoutSoonDays: 7,
  manageMaxDays: 30,
  overstockCoverageDays: 90,
  stagnantDays: 30,
};

export interface InventoryValueBreakdown {
  normalStockValue: number; // 기본 재고자산 (정상재고 × 원가)
  availableStockValue: number; // 참고용
  defectiveStockValue: number;
  incomingStockValue: number;
}

export interface SnapshotKpis {
  /** 기준일에 실제 업로드가 있어 오늘 값으로 집계된 SKU 수 (positiveStockSkuCount + zeroStockSkuCount +
   * negativeStockSkuCount와 일치). 자료를 올리지 않은 날짜(stale)는 어떤 집계에도 섞이지 않는다. */
  observedSkuCount: number;
  positiveStockSkuCount: number;
  zeroStockSkuCount: number;
  negativeStockSkuCount: number;
  /** 양수 정상재고 SKU / 기준일에 실제 관측된 SKU(observedSkuCount). 주문 충족률이 아니다. */
  inStockSkuRatio: number | null;
  valuedSkuCount: number;
  unvaluedSkuCount: number;
  knownInventoryValue: number | null;
  valuationCoverageRatio: number | null;
  /** 기준일에 자료가 올라오지 않아(과거 스냅샷을 그대로 쓰는) 위 집계에서 제외된 SKU 수. */
  staleSkuCount: number;
  /** 품절 인식(isSoldOut)되어 1개월 유예기간 내 노출 중인 SKU 수 — staleSkuCount의 부분집합. */
  soldOutSkuCount: number;
  oldestObservationDate: string | null;
  newestObservationDate: string | null;
  /** 집계 시작일 — 이 SKU 집합에서 자료를 가장 먼저 관측한 날짜(SKU.firstSeenDate 최솟값).
   * oldestObservationDate("가장 오래된 직전 관측일", latest.date 기준)와는 다른 값이다. */
  earliestFirstSeenDate: string | null;
  comparableSkuCount: number;
  observedDecrease: number | null;
  observedIncrease: number | null;
  recordedInbound: number | null;
  estimatedDepletion: number | null;
  /** 입고로 설명되지 않는 증가(재고가 늘었지만 입고 기록에 없는 양)의 합. */
  unexplainedIncreaseTotal: number | null;
  /** 위 합계에 기여한 SKU 목록(0보다 큰 것만) — 툴팁에서 상품코드 확인용.
   * observedDate: 증가가 관측된 스냅샷 날짜. 입고 특이사항은 이 날짜(직전 관측일 초과 ~ 이 날짜 이내)로
   * 등록해야 반영된다 — 등록일이 이보다 늦으면(예: 실제 입고는 9/17에 반영됐는데 9/18로 등록) 계속 미입고로 남는다. */
  unexplainedIncreaseSkus: { skuId: string; productCode: string; productName: string; amount: number; observedDate: string }[];
}

export interface CompanyKpis {
  snapshot: SnapshotKpis;
  totalSkuCount: number;
  totalAvailableStock: number;
  totalInventoryValue: number;
  netChangeVsYesterday: number | null;
  totalDepletion7d: number;
  /** 기간 비교 모드에서 SKU별 실제 관측 기간에 맞춰 계산한 일평균 감소량의 평균 (SKU마다 관측 기간이
   * 다를 수 있어 전체 합계를 단일 기간일수로 나누지 않는다). 비교 가능한 SKU가 없으면 null. */
  averageDailyDecreasePerSku?: number | null;
  dangerSkuCount: number;
  stockoutSoon30dCount: number;
  stagnantValue: number;
  totalDecrease?: number;
  totalIncrease?: number;
  forecastReadyCount?: number;
  overstockCandidateValue?: number;
}

export interface PeriodComparison {
  requestedStartDate: string;
  requestedEndDate: string;
  actualStartDate: string;
  actualEndDate: string;
  startAvailableStock: number;
  endAvailableStock: number;
  netChange: number;
  totalDepletion: number;
  totalIncrease: number;
  totalInboundQuantity?: number;
  observedDays: number;
  averageDailyDepletion: number | null;
}

export interface WarehouseSummary {
  snapshot: SnapshotKpis;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  skuCount: number;
  inventoryValue: number;
  dangerSkuCount: number;
  dangerRatio: number;
  stockoutSoon30dRatio: number;
  stagnantRatio: number;
  overstockCandidateRatio: number;
}

/** SKU 한 건에 대한 계산된 전체 분석 결과 (테이블/상세/Action Center가 공유) */
export interface SkuAnalysis {
  /** Current app policy: calendar windows with shipping-day denominators; missing is never zero stock. */
  operating?: {
    reason: string | null; isB2B: boolean; isMissing: boolean; staleShippingDays: number;
    basisWindowDays: number | null; observedShippingDays: number; unexplainedIncrease: number; intervalCount: number;
  };
  asOfDate: string;
  latest: StockObservation;
  previous: StockObservation | null;
  dailyChange: number | null;
  maturity: DataMaturity;
  window7: WindowDepletion;
  window14: WindowDepletion;
  window30: WindowDepletion;
  coverage: CoverageAssessment;
  forecast: StockoutForecast;
  acceleration: DepletionAcceleration;
  thresholdRisk: ThresholdRisk;
  /** thresholdRisk 판정에 실제로 쓰인 위험/경고수량과 그 출처(수동/레거시/자동/없음) */
  riskThresholds: EffectiveRiskThresholds;
  /** 소비기한 안에 다 팔지 못할 위험(Coverage와 소비기한 갭 비교) */
  expirationRisk: ExpirationRiskAssessment;
  stagnation: StagnationInfo;
  overstock: OverstockCandidateInfo;
  /** 화면에 그대로 표시할 수 있는 근거 태그 목록 (예: "[위험수량 이하]", "[12일분 남음]") */
  tags: string[];
  stockIncreasedToday: boolean;
  /** 오늘 새롭게 위험/주의 단계로 악화됐는지(어제 정상 → 오늘 주의/위험 등) */
  newlyAtRisk: boolean;
  /** 추정 신뢰도(출처 × 관측 밀도 × 경과 감쇠). forecast.confidence는 이 값의 level이다. */
  reliability?: import('@/domain/reliability/reliability').Reliability;
}
