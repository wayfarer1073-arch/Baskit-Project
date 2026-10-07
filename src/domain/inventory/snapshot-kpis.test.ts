import { describe, expect, it } from 'vitest';
import { calculateCompanyKpis, calculateSnapshotKpis, calculateWarehouseSummaries } from './aggregation';
import { analyzeSku, calculateInventoryValueBreakdown, calculatePeriodComparison } from './calculations';
import { resolveInventoryCost } from './costs';
import { buildSummarySheetRows } from '../excel/export';
import type { StockObservation } from './types';
import type { InventoryRow } from './read-model';

function obs(date: string, normalStock: number, rest: Partial<StockObservation> = {}): StockObservation {
  return { date, normalStock, availableStock: normalStock, unitCost: 10, defectiveStock: 0, incomingStock: 0, warningQty: 0, dangerQty: 0, ...rest };
}
function row(id: string, observations: StockObservation[], asOf = '2026-09-08', from?: string, isSoldOut = false): InventoryRow {
  const analysis = analyzeSku(observations, asOf)!;
  return {
    descriptor: {
      skuId: id, productCode: id, productName: id, warehouseId: 'w', warehouseCode: 'A', warehouseName: 'A',
      option: null, barcode: null, location: null, manualDangerQty: null, manualWarningQty: null,
      expirationDate: null, expirationRiskDays: null, isB2B: false, firstSeenDate: observations[0]?.date ?? asOf,
      isSoldOut, soldOutDetectedDate: isSoldOut ? observations.at(-1)?.date ?? asOf : null,
      eaPerBox: null, eaPerPallet: null, packagingBarcode: null,
    },
    analysis, valueBreakdown: calculateInventoryValueBreakdown(analysis.latest),
    periodComparison: from ? calculatePeriodComparison(observations, from, asOf) : null,
  };
}

describe('directly observed snapshot KPIs', () => {
  it('empty data is unknown, not zero percent or a zero valuation', () => {
    expect(calculateSnapshotKpis([])).toMatchObject({ inStockSkuRatio: null, knownInventoryValue: null, observedDecrease: null, comparableSkuCount: 0 });
  });
  it('uses SKU count, separates zero and negative inventory, excludes stale (no-upload-today) SKUs from every current-status tally', () => {
    const s = calculateSnapshotKpis([
      row('a', [obs('2026-09-08', 1000)]),
      row('b', [obs('2026-09-08', 0)]),
      row('d', [obs('2026-09-08', -50)]),
      row('c', [obs('2026-09-01', -100)]), // 기준일(09-08)에 업로드가 없어 stale — 현재 집계에서 제외
    ]);
    expect(s).toMatchObject({
      observedSkuCount: 3,
      positiveStockSkuCount: 1,
      zeroStockSkuCount: 1,
      negativeStockSkuCount: 1,
      knownInventoryValue: 10000,
      valuedSkuCount: 2,
      unvaluedSkuCount: 1,
      staleSkuCount: 1,
      oldestObservationDate: '2026-09-01',
      newestObservationDate: '2026-09-08',
    });
    expect(s.inStockSkuRatio).toBeCloseTo(1 / 3);
  });
  it('집계 시작일(earliestFirstSeenDate)은 최신 관측일이 아니라 SKU가 처음 관측된 날짜 중 최솟값이다', () => {
    // 'old'는 8월부터 쌓인 SKU지만 오늘도 정상 업로드돼 latest.date는 다른 SKU와 동일하게 최신이다.
    // oldestObservationDate(직전 관측일 기준)는 이 차이를 반영하지 못하지만 earliestFirstSeenDate는 반영해야 한다.
    const old = row('old', [obs('2026-08-01', 100), obs('2026-09-08', 90)], '2026-09-08');
    const recent = row('recent', [obs('2026-09-08', 50)], '2026-09-08');
    const s = calculateSnapshotKpis([old, recent]);
    expect(s.oldestObservationDate).toBe('2026-09-08');
    expect(s.newestObservationDate).toBe('2026-09-08');
    expect(s.earliestFirstSeenDate).toBe('2026-08-01');
  });
  it('does not turn missing costs into known zero; honors uploaded total and explicit zero', () => {
    const missing = resolveInventoryCost({ normalStock: 10, unitCost: 0, unitCostProvided: false, totalCost: null }, null);
    const zero = resolveInventoryCost({ normalStock: 10, unitCost: 0, unitCostProvided: true, totalCost: null }, null);
    expect(missing.valuationKnown).toBe(false);
    expect(zero.valuationKnown).toBe(true);
    const rows = [row('missing', [obs('2026-09-08', 10, missing)]), row('zero', [obs('2026-09-08', 10, zero)]), row('total', [obs('2026-09-08', 10, { totalCost: 95 })])];
    expect(calculateSnapshotKpis(rows)).toMatchObject({ knownInventoryValue: 95, valuedSkuCount: 2, unvaluedSkuCount: 1 });
    expect(calculateSnapshotKpis(rows.slice(0, 1)).knownInventoryValue).toBeNull();
  });
  it('separates net changes and inbound-adjusted depletion in both modes', () => {
    const observations = [obs('2026-09-01', 100), obs('2026-09-08', 120, { inboundQuantity: 50 })];
    const r = row('a', observations, '2026-09-08', '2026-09-01');
    for (const from of [undefined, '2026-09-01']) {
      expect(calculateSnapshotKpis([r], from)).toMatchObject({ comparableSkuCount: 1, observedDecrease: 0, observedIncrease: 20, recordedInbound: 50, estimatedDepletion: 30 });
    }
  });
  it('sums increases not explained by recorded inbound, and lists only the contributing SKUs', () => {
    const explained = row('explained', [obs('2026-09-01', 100), obs('2026-09-08', 150, { inboundQuantity: 50 })], '2026-09-08', '2026-09-01');
    const unexplained = row('unexplained', [obs('2026-09-01', 100), obs('2026-09-08', 170, { inboundQuantity: 50 })], '2026-09-08', '2026-09-01');
    for (const from of [undefined, '2026-09-01']) {
      const s = calculateSnapshotKpis([explained, unexplained], from);
      expect(s.unexplainedIncreaseTotal).toBe(20);
      expect(s.unexplainedIncreaseSkus).toEqual([{ skuId: 'unexplained', productCode: 'unexplained', productName: 'unexplained', amount: 20, observedDate: '2026-09-08' }]);
    }
  });
  it('excludes missing endpoints, new SKUs and zero-day intervals without daily fallback', () => {
    const rows = [
      row('exact', [obs('2026-09-01', 100), obs('2026-09-08', 70)], '2026-09-08', '2026-09-01'),
      row('new', [obs('2026-09-05', 50), obs('2026-09-08', 20)], '2026-09-08', '2026-09-01'),
      row('stale', [obs('2026-09-01', 100), obs('2026-09-07', 10)], '2026-09-08', '2026-09-01'),
      row('old-start', [obs('2026-08-31', 100), obs('2026-09-08', 10)], '2026-09-08', '2026-09-01'),
    ];
    expect(calculateSnapshotKpis(rows, '2026-09-01')).toMatchObject({ comparableSkuCount: 1, observedDecrease: 30, estimatedDepletion: 30 });
    expect(calculateSnapshotKpis(rows.slice(1), '2026-09-01').estimatedDepletion).toBeNull();
    expect(calculateSnapshotKpis([row('same', [obs('2026-09-08', 10)], '2026-09-08', '2026-09-08')], '2026-09-08').comparableSkuCount).toBe(0);
  });
  it('exports the same direct metrics as dashboard and warehouse summaries', () => {
    const rows = [row('a', [obs('2026-09-08', 10)])];
    const company = calculateCompanyKpis(rows, 30);
    const warehouses = calculateWarehouseSummaries(rows, 30);
    expect(warehouses[0].snapshot).toEqual(company.snapshot);
    const sheet = buildSummarySheetRows(company, warehouses);
    expect(sheet).toContainEqual({ 항목: '평가 가능한 재고금액', 값: 100 });
    expect(sheet).toContainEqual({ 항목: '재고 보유 SKU 비율(%)', 값: 100 });
  });
});

describe('weekend/holiday carry-forward (매출은 발생하지만 업로드는 없는 날)', () => {
  it('기준일이 일요일이면 직전 영업일(금요일) 관측치를 stale로 보지 않는다', () => {
    // 2026-09-06은 일요일, 직전 영업일은 2026-09-04(금)이다.
    const s = calculateSnapshotKpis([row('a', [obs('2026-09-04', 100)], '2026-09-06')]);
    expect(s).toMatchObject({ observedSkuCount: 1, staleSkuCount: 0 });
  });
  it('기준일이 평일이면 주말만 지나온 것으로는 최신성을 인정하지 않는다(월요일 자료 누락은 여전히 stale)', () => {
    // 2026-09-08은 화요일. 직전 영업일은 2026-09-07(월)이므로, 2026-09-04(금) 관측은 stale이다.
    const s = calculateSnapshotKpis([row('a', [obs('2026-09-04', 100)], '2026-09-08')]);
    expect(s).toMatchObject({ observedSkuCount: 0, staleSkuCount: 1 });
  });
  it('공휴일로 지정한 평일도 주말과 동일하게 취급한다', () => {
    // 2026-09-07은 월요일이지만 공휴일로 지정 -> 직전 영업일은 2026-09-04(금)이다.
    const holidays = new Set(['2026-09-07']);
    const s = calculateSnapshotKpis([row('a', [obs('2026-09-04', 100)], '2026-09-07')], null, holidays);
    expect(s).toMatchObject({ observedSkuCount: 1, staleSkuCount: 0 });
  });
});

describe('목록 미관측 SKU는 마지막 재고를 현재 재고로 합산하지 않는다', () => {
  it('이력 노출 중인 미관측 SKU도 현재 보유 수량·금액에서는 제외한다', () => {
    const s = calculateSnapshotKpis([row('a', [obs('2026-09-04', 50)], '2026-09-08', undefined, true)]);
    expect(s).toMatchObject({ observedSkuCount: 0, staleSkuCount: 1, positiveStockSkuCount: 0, knownInventoryValue: null, soldOutSkuCount: 1 });
  });
  it('isSoldOut이 아니면 동일한 공백은 여전히 stale로 집계되지만, "품절 SKU"에는 잡히지 않는다(대조군)', () => {
    const s = calculateSnapshotKpis([row('a', [obs('2026-08-01', 50)], '2026-09-08', undefined, false)]);
    expect(s).toMatchObject({ observedSkuCount: 0, staleSkuCount: 1, soldOutSkuCount: 0 });
  });
  it('"품절 SKU"는 정상재고=0인 SKU나 단순 업로드 지연 SKU를 세지 않고, isSoldOut인 SKU만 센다', () => {
    const soldOut = row('soldout', [obs('2026-09-02', 50)], '2026-09-08', undefined, true);
    const zeroStock = row('zero', [obs('2026-09-08', 0)]);
    const lateUpload = row('late', [obs('2026-09-01', 10)], '2026-09-08');
    const s = calculateSnapshotKpis([soldOut, zeroStock, lateUpload]);
    expect(s.soldOutSkuCount).toBe(1);
    expect(s.zeroStockSkuCount).toBe(1);
    expect(s.staleSkuCount).toBe(2);
  });
});

describe('forecast and risk regressions', () => {
  it('a long history cannot qualify one recent day as seven observed days', () => {
    const a = analyzeSku([obs('2026-01-01', 1000), obs('2026-09-07', 900), obs('2026-09-08', 800)], '2026-09-08')!;
    expect(a.forecast.expectedStockoutDate).toBeNull();
    expect(a.coverage.coverageDays).toBeNull();
    expect(a.riskThresholds.source).toBe('none');
  });
  it('forecast and coverage share the same fallback basis and sparse data is LOW', () => {
    const a = analyzeSku([obs('2026-08-09', 100), obs('2026-09-08', 70)], '2026-09-08')!;
    expect(a.coverage.coverageDays).toBe(70);
    expect(a.forecast.expectedStockoutDays).toBe(70);
    expect(a.forecast.basisWindowDays).toBe(30);
    expect(a.forecast.confidence).toBe('LOW');
  });
  it('does not advance stagnation or forecasts without a new observation', () => {
    const observations = [obs('2026-08-01', 100), obs('2026-09-01', 100)];
    expect(analyzeSku(observations, '2026-09-18')!.stagnation.stagnantDays).toBe(31);
    const moving = [obs('2026-09-01', 100), obs('2026-09-08', 30)];
    expect(analyzeSku(moving, '2026-10-01')!.forecast).toEqual(analyzeSku(moving, '2026-09-08')!.forecast);
  });
  it('zero stock is a risk even without a depletion history', () => {
    expect(analyzeSku([obs('2026-09-08', 0)], '2026-09-08')!.thresholdRisk.level).toBe('DANGER');
  });
  it('expired positive stock is flagged without a rate; empty stock is not an expiration risk', () => {
    const expiry = { expirationDate: '2026-09-01', expirationRiskDays: 14 };
    expect(analyzeSku([obs('2026-09-08', 10)], '2026-09-08', undefined, undefined, expiry)!.expirationRisk.isAtRisk).toBe(true);
    expect(analyzeSku([obs('2026-09-01', 100), obs('2026-09-08', 0)], '2026-09-08', undefined, undefined, expiry)!.expirationRisk.isAtRisk).toBe(false);
  });
});

describe('"품절 SKU"는 최근 7일 안에 품절로 바뀐 SKU만 센다', () => {
  it('기준일 포함 7일(9/2~9/8) 안의 품절 전환만 세고, 그 전부터 이어진 품절은 세지 않는다', () => {
    const at = (id: string, date: string) => row(id, [obs(date, 30)], '2026-09-08', undefined, true);
    const s = calculateSnapshotKpis([at('today', '2026-09-08'), at('day7', '2026-09-02'), at('day8', '2026-09-01'), at('old', '2026-08-01')]);
    expect(s.soldOutSkuCount).toBe(2);
    expect(s.staleSkuCount).toBe(4);
  });
});
