import { latestShippingDay as mostRecentBusinessDayOnOrBefore, NO_HOLIDAYS } from './shipping-calendar';
import { buildDailyDeltas, isNewlyAtRisk } from './calculations';
import type { CompanyKpis, SnapshotKpis, WarehouseSummary } from './types';
import type { InventoryRow } from './read-model';

// ---- 집계 ----

/** 기간 모드는 양 끝 날짜가 정확히 일치하는 동일 SKU만 비교한다. 신규/누락 SKU는 0으로 대체하지 않는다. */
export function calculateSnapshotKpis(rows: InventoryRow[], compareFromDate?: string | null, holidays: ReadonlySet<string> = NO_HOLIDAYS): SnapshotKpis {
  const result: SnapshotKpis = {
    observedSkuCount: 0,
    positiveStockSkuCount: 0,
    zeroStockSkuCount: 0,
    negativeStockSkuCount: 0,
    inStockSkuRatio: null,
    valuedSkuCount: 0,
    unvaluedSkuCount: 0,
    knownInventoryValue: null,
    valuationCoverageRatio: null,
    staleSkuCount: 0,
    oldestObservationDate: null,
    newestObservationDate: null,
    comparableSkuCount: 0,
    observedDecrease: null,
    observedIncrease: null,
    recordedInbound: null,
    estimatedDepletion: null,
    unexplainedIncreaseTotal: null,
    unexplainedIncreaseSkus: [],
    earliestFirstSeenDate: null,
    soldOutSkuCount: 0,
  };
  for (const row of rows) {
    const { latest, previous, asOfDate } = row.analysis;
    if (!result.oldestObservationDate || latest.date < result.oldestObservationDate) result.oldestObservationDate = latest.date;
    if (!result.newestObservationDate || latest.date > result.newestObservationDate) result.newestObservationDate = latest.date;
    // SKU가 처음 관측된 날짜(DB에 고정된 firstSeenDate) 중 가장 이른 값 — "집계 시작일"은 이걸로
    // 계산해야 한다. latest.date(직전 관측일) 기준으로는 대부분의 SKU가 최근 날짜에 몰려 있어
    // "데이터를 언제부터 모으기 시작했는지"를 보여주지 못한다(oldestObservationDate와는 다른 값).
    if (!result.earliestFirstSeenDate || row.descriptor.firstSeenDate < result.earliestFirstSeenDate) {
      result.earliestFirstSeenDate = row.descriptor.firstSeenDate;
    }

    // 목록 이탈은 품절의 증거가 아니다. 마지막 재고를 현재 자산으로 다시 집계하지 않는다.
    if (row.descriptor.isSoldOut) {
      result.staleSkuCount++;
      // "품절 SKU"는 이 값(실제로 품절 인식되어 1개월 유예기간 내 노출 중인 SKU 수)만 센다 —
      // 정상재고=0이지만 여전히 목록에 있는 SKU나, 단순히 오늘 업로드가 늦은 SKU는 포함하지 않는다.
      result.soldOutSkuCount++;
      continue;
    }
    // 주말·등록 공휴일은 출고가 없으므로 마지막 영업일 재고를 인정한다. 운영 분석이 이미 창고별 달력(휴무일에
    // 실제로 올라온 자료 포함)으로 자료 공백을 셌으면 그 값을 쓴다 — 한 창고의 주말 업로드가 다른 창고를
    // "자료 갱신 필요"로 만들지 않도록.
    const stale = row.analysis.operating ? row.analysis.operating.staleShippingDays > 0 : latest.date < mostRecentBusinessDayOnOrBefore(asOfDate, holidays);
    if (stale) {
      result.staleSkuCount++;
    } else {
      result.observedSkuCount++;
      if (latest.normalStock > 0) result.positiveStockSkuCount++;
      else if (latest.normalStock === 0) result.zeroStockSkuCount++;
      else result.negativeStockSkuCount++;
      // 음수재고는 정합성 오류로 별도 표시하고 양수 재고자산을 상쇄하지 않는다.
      const known = latest.valuationKnown ?? (latest.totalCost !== undefined || latest.unitCost > 0 || latest.normalStock === 0);
      if (known && latest.normalStock >= 0 && Number.isFinite(row.valueBreakdown.normalStockValue) && row.valueBreakdown.normalStockValue >= 0) {
        result.valuedSkuCount++;
        result.knownInventoryValue = (result.knownInventoryValue ?? 0) + row.valueBreakdown.normalStockValue;
      } else result.unvaluedSkuCount++;
    }

    const period = row.periodComparison;
    if (latest.normalStock < 0 || (!compareFromDate && previous && previous.normalStock < 0) || (compareFromDate && period && period.startAvailableStock < 0)) continue;
    if (compareFromDate) {
      if (!period || period.actualStartDate !== compareFromDate || period.actualEndDate !== asOfDate || period.observedDays <= 0) continue;
    } else if (!previous) continue;
    const change = compareFromDate ? period!.netChange : latest.availableStock - previous!.availableStock;
    const delta = !compareFromDate ? buildDailyDeltas([previous!, latest])[0] : null;
    if (!compareFromDate && !delta) continue;
    result.comparableSkuCount++;
    result.observedDecrease = (result.observedDecrease ?? 0) + Math.max(-change, 0);
    result.observedIncrease = (result.observedIncrease ?? 0) + Math.max(change, 0);
    result.recordedInbound = (result.recordedInbound ?? 0) + (compareFromDate ? (period!.totalInboundQuantity ?? 0) : delta!.inboundQuantity);
    result.estimatedDepletion = (result.estimatedDepletion ?? 0) + (compareFromDate ? period!.totalDepletion : delta!.depletion);
    const unexplainedIncrease = compareFromDate ? period!.totalIncrease : delta!.increase;
    if (unexplainedIncrease > 0) {
      result.unexplainedIncreaseTotal = (result.unexplainedIncreaseTotal ?? 0) + unexplainedIncrease;
      const observedDate = compareFromDate ? period!.actualEndDate : delta!.toDate;
      result.unexplainedIncreaseSkus.push({
        skuId: row.descriptor.skuId,
        productCode: row.descriptor.productCode,
        productName: row.descriptor.productName,
        amount: unexplainedIncrease,
        observedDate,
      });
    }
  }
  if (result.observedSkuCount) {
    result.inStockSkuRatio = result.positiveStockSkuCount / result.observedSkuCount;
    result.valuationCoverageRatio = result.valuedSkuCount / result.observedSkuCount;
  }
  return result;
}

export function calculateCompanyKpis(
  rows: InventoryRow[],
  stagnantDaysThreshold: number,
  compareFromDate?: string | null,
  holidays: ReadonlySet<string> = NO_HOLIDAYS,
): CompanyKpis {
  let totalAvailableStock = 0;
  let totalInventoryValue = 0;
  let netChangeVsYesterday = 0;
  let hasAnyDayOverDay = false;
  let totalDepletion7d = 0;
  let dangerSkuCount = 0;
  let stockoutSoon30dCount = 0;
  let stagnantValue = 0;
  let totalDecrease = 0;
  let totalIncrease = 0;
  let forecastReadyCount = 0;
  let overstockCandidateValue = 0;
  let sumOfPerSkuDailyDecreaseRates = 0;
  let skusWithPeriodRate = 0;

  for (const row of rows) {
    if (row.descriptor.isSoldOut) continue;
    totalAvailableStock += row.analysis.latest.availableStock;
    totalInventoryValue += row.valueBreakdown.normalStockValue;
    totalDepletion7d += row.analysis.window7.totalDepletion;
    if (row.analysis.thresholdRisk.level === 'DANGER') dangerSkuCount += 1;
    // "30일 내 소진 예상"은 설정 페이지의 "관리 필요/정상 경계"(manageMaxDays, 기본 30일) 임계값을
    // 그대로 따라야 한다. coverageDays를 30으로 재하드코딩하면 admin이 이 기준을 바꿔도(예: 45일)
    // 이 KPI만 조용히 어긋난다 — band는 이미 그 설정으로 계산돼 있으므로 재사용한다.
    if (row.analysis.coverage.band === 'STOCKOUT_SOON' || row.analysis.coverage.band === 'NEEDS_MANAGEMENT') stockoutSoon30dCount += 1;
    if (row.analysis.forecast.expectedStockoutDays !== null) forecastReadyCount += 1;
    if (row.analysis.overstock.isCandidate) overstockCandidateValue += row.valueBreakdown.normalStockValue;
    if (row.analysis.stagnation.isMeaningful && row.analysis.stagnation.stagnantDays >= stagnantDaysThreshold) {
      stagnantValue += row.valueBreakdown.normalStockValue;
    }
    if (row.analysis.dailyChange !== null) {
      hasAnyDayOverDay = true;
      netChangeVsYesterday += row.analysis.dailyChange;
    }
    if (row.periodComparison) {
      totalDecrease += row.periodComparison.totalDepletion;
      totalIncrease += row.periodComparison.totalIncrease;
      // "기간 일평균 감소"는 SKU마다 실제 관측 기간(observedDays)이 다를 수 있으므로, 전체
      // 합계를 하나의 (요청된) 기간 일수로 나누지 않는다. 대신 SKU별로 자기 자신의 관측 기간에
      // 맞춰 계산한 일평균을 먼저 구하고, 그 값들의 평균을 낸다.
      if (row.periodComparison.observedDays > 0) {
        sumOfPerSkuDailyDecreaseRates += row.periodComparison.totalDepletion / row.periodComparison.observedDays;
        skusWithPeriodRate += 1;
      }
    } else if (!compareFromDate && row.analysis.dailyChange !== null) {
      totalDecrease += Math.max(-row.analysis.dailyChange, 0);
      totalIncrease += Math.max(row.analysis.dailyChange, 0);
    }
  }

  return {
    snapshot: calculateSnapshotKpis(rows, compareFromDate, holidays),
    totalSkuCount: rows.length,
    totalAvailableStock,
    totalInventoryValue,
    netChangeVsYesterday: hasAnyDayOverDay ? netChangeVsYesterday : null,
    totalDepletion7d,
    averageDailyDecreasePerSku: skusWithPeriodRate > 0 ? sumOfPerSkuDailyDecreaseRates / skusWithPeriodRate : null,
    dangerSkuCount,
    stockoutSoon30dCount,
    stagnantValue,
    totalDecrease,
    totalIncrease,
    forecastReadyCount,
    overstockCandidateValue,
  };
}

export function calculateWarehouseSummaries(rows: InventoryRow[], stagnantDaysThreshold: number, holidays: ReadonlySet<string> = NO_HOLIDAYS): WarehouseSummary[] {
  const byWarehouse = new Map<string, InventoryRow[]>();
  for (const row of rows) {
    const list = byWarehouse.get(row.descriptor.warehouseId) ?? [];
    list.push(row);
    byWarehouse.set(row.descriptor.warehouseId, list);
  }

  return [...byWarehouse.entries()].map(([warehouseId, whRows]) => {
    const skuCount = whRows.length;
    const inventoryValue = whRows.filter((r) => !r.descriptor.isSoldOut).reduce((sum, r) => sum + r.valueBreakdown.normalStockValue, 0);
    const dangerSkuCount = whRows.filter((r) => r.analysis.thresholdRisk.level === 'DANGER').length;
    const stockoutSoonCount = whRows.filter((r) => r.analysis.coverage.band === 'STOCKOUT_SOON' || r.analysis.coverage.band === 'NEEDS_MANAGEMENT').length;
    const stagnantCount = whRows.filter((r) => r.analysis.stagnation.isMeaningful && r.analysis.stagnation.stagnantDays >= stagnantDaysThreshold).length;
    const overstockCount = whRows.filter((r) => r.analysis.overstock.isCandidate).length;

    return {
      snapshot: calculateSnapshotKpis(whRows, null, holidays),
      warehouseId,
      warehouseCode: whRows[0].descriptor.warehouseCode,
      warehouseName: whRows[0].descriptor.warehouseName,
      skuCount,
      inventoryValue,
      dangerSkuCount,
      dangerRatio: skuCount > 0 ? dangerSkuCount / skuCount : 0,
      stockoutSoon30dRatio: skuCount > 0 ? stockoutSoonCount / skuCount : 0,
      stagnantRatio: skuCount > 0 ? stagnantCount / skuCount : 0,
      overstockCandidateRatio: skuCount > 0 ? overstockCount / skuCount : 0,
    };
  });
}

export type ActionCenterCategory = 'NEW_DANGER' | 'STOCKOUT_SOON' | 'ACCELERATING' | 'STAGNANT' | 'OVERSTOCK_CANDIDATE' | 'EXPIRATION_RISK';

export interface ActionCenterCard {
  category: ActionCenterCategory;
  title: string;
  count: number;
  sampleSkus: { skuId: string; productName: string; productCode: string; warehouseName: string; detail: string }[];
}

export function buildActionCenterCards(rows: InventoryRow[], stagnantDaysThreshold: number): ActionCenterCard[] {
  const newDanger = rows.filter((r) => isNewlyAtRisk(r.analysis));
  const stockoutSoon = rows.filter((r) => r.analysis.coverage.band === 'STOCKOUT_SOON');
  const accelerating = rows.filter((r) => r.analysis.acceleration.trend === 'ACCELERATING');
  const stagnant = rows.filter((r) => r.analysis.stagnation.isMeaningful && r.analysis.stagnation.stagnantDays >= stagnantDaysThreshold);
  const overstock = rows.filter((r) => r.analysis.overstock.isCandidate);
  const expirationRisk = rows.filter((r) => r.analysis.expirationRisk.isAtRisk);

  const toSample = (list: InventoryRow[], detailFn: (r: InventoryRow) => string) =>
    list.slice(0, 3).map((r) => ({
      skuId: r.descriptor.skuId,
      productName: r.descriptor.productName,
      productCode: r.descriptor.productCode,
      warehouseName: r.descriptor.warehouseName,
      detail: detailFn(r),
    }));

  return [
    {
      category: 'NEW_DANGER',
      title: '신규 위험 SKU',
      count: newDanger.length,
      sampleSkus: toSample(newDanger, (r) => (r.analysis.thresholdRisk.reason ? r.analysis.thresholdRisk.reason : '상태 악화')),
    },
    {
      category: 'STOCKOUT_SOON',
      title: '품절 임박 SKU',
      count: stockoutSoon.length,
      sampleSkus: toSample(stockoutSoon, (r) => `${Math.floor(r.analysis.coverage.coverageDays ?? 0)}출고일분 남음`),
    },
    {
      category: 'ACCELERATING',
      title: '소진 가속 SKU',
      count: accelerating.length,
      sampleSkus: toSample(accelerating, (r) => `소진속도 +${Math.round(r.analysis.acceleration.accelerationRatePercent ?? 0)}%`),
    },
    {
      category: 'STAGNANT',
      title: '장기 정체 SKU',
      count: stagnant.length,
      sampleSkus: toSample(stagnant, (r) => `${r.analysis.stagnation.stagnantDays}출고일간 소진 미관측`),
    },
    {
      category: 'OVERSTOCK_CANDIDATE',
      title: '과잉재고 후보',
      count: overstock.length,
      sampleSkus: toSample(overstock, (r) => `${Math.floor(r.analysis.overstock.coverageDays ?? 0)}출고일분 재고`),
    },
    {
      category: 'EXPIRATION_RISK',
      title: '소비기한 확인 필요',
      count: expirationRisk.length,
      sampleSkus: toSample(expirationRisk, (r) => `소비기한 잔여 ${r.analysis.expirationRisk.daysUntilExpiration}달력일 · 로트 잔량 확인 필요`),
    },
  ];
}
