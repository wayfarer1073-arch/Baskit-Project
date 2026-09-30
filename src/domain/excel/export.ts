import type { CompanyKpis, InventoryValueBreakdown, SkuAnalysis, WarehouseSummary } from '@/domain/inventory/types';

/** Excel export는 분석된 결과만 내보낸다(원본 파일 재다운로드 아님). 이 모듈은 시트별 row 배열(순수 객체)만 만든다 — 실제 파일 I/O는 얇은 wrapper에서 처리한다. */

export interface ExportRowInput {
  productCode: string;
  productName: string;
  warehouseName: string;
  analysis: SkuAnalysis;
  valueBreakdown: InventoryValueBreakdown;
}

function riskLabelOf(level: SkuAnalysis['thresholdRisk']['level']): string {
  if (level === 'DANGER') return '위험';
  if (level === 'WARNING') return '주의';
  if (level === 'UNKNOWN') return '개별 확인';
  return '기준 내';
}

export function buildInventorySheetRows(rows: ExportRowInput[]): Record<string, string | number>[] {
  return rows.map((r) => ({
    상품코드: r.productCode,
    상품명: r.productName,
    창고: r.warehouseName,
    현재가용재고: r.analysis.operating?.isMissing ? 0 : r.analysis.latest.availableStock,
    정상재고: r.analysis.operating?.isMissing ? 0 : r.analysis.latest.normalStock,
    마지막관측재고: r.analysis.latest.normalStock,
    운영유형: r.analysis.operating?.isB2B ? '특수 관리' : '일반 판매',
    재고관측일: r.analysis.latest.date,
    기준일미관측: (r.analysis.operating
      ? r.analysis.operating.isMissing || r.analysis.operating.staleShippingDays > 0
      : r.analysis.latest.date < r.analysis.asOfDate) ? '예' : '아니오',
    직전관측대비: r.analysis.dailyChange ?? '',
    '관측일기준7일추정소진량': r.analysis.window7.observedIntervalDays > 0 ? r.analysis.window7.totalDepletion : '관측 부족',
    '최근7일입고반영량': r.analysis.window7.totalInboundQuantity ?? 0,
    '최근7일출고일평균추정소진': r.analysis.window7.averageDailyDepletion ?? '',
    커버리지근거기간: r.analysis.operating?.basisWindowDays ?? '',
    커버리지관측출고일수: r.analysis.operating?.observedShippingDays ?? '',
    '7일vs이전7일변화율(%)': r.analysis.acceleration.accelerationRatePercent ?? '',
    'Coverage(출고일)': r.analysis.coverage.coverageDays ?? '산정 불가',
    예상소진일: r.analysis.forecast.expectedStockoutDate ?? r.analysis.operating?.reason ?? '산정 불가',
    단위원가: r.analysis.latest.unitCost,
    재고금액: r.analysis.operating?.isMissing ? 0 : r.analysis.latest.valuationKnown === false || r.analysis.latest.normalStock < 0 ? '평가 불가' : r.valueBreakdown.normalStockValue,
    무소진관측출고일수: r.analysis.stagnation.isMeaningful ? r.analysis.stagnation.stagnantDays : '',
    상태: r.analysis.operating?.reason ?? riskLabelOf(r.analysis.thresholdRisk.level),
    태그: r.analysis.tags.join(' '),
  }));
}

export function buildRiskSheetRows(rows: ExportRowInput[]): Record<string, string | number>[] {
  return buildInventorySheetRows(rows.filter((r) => r.analysis.thresholdRisk.level === 'DANGER' || r.analysis.thresholdRisk.level === 'WARNING' || r.analysis.coverage.band === 'STOCKOUT_SOON'));
}

export function buildStagnantSheetRows(rows: ExportRowInput[]): Record<string, string | number>[] {
  return buildInventorySheetRows(rows.filter((r) => r.analysis.tags.some((t) => t.startsWith('[재고 정체'))));
}

export function buildSummarySheetRows(kpis: CompanyKpis, warehouseSummaries: WarehouseSummary[]): Record<string, string | number>[] {
  const s = kpis.snapshot;
  const rows: Record<string, string | number>[] = [
    { 항목: '관리 SKU 수', 값: kpis.totalSkuCount },
    { 항목: '평가 가능한 재고금액', 값: s.knownInventoryValue ?? '평가 불가' },
    { 항목: '평가 가능한 SKU 수', 값: s.valuedSkuCount },
    { 항목: '원가 미상·오류 SKU 수', 값: s.unvaluedSkuCount },
    { 항목: '재고 보유 SKU 비율(%)', 값: s.inStockSkuRatio === null ? '산정 불가' : s.inStockSkuRatio * 100 },
    { 항목: '무재고 SKU 수', 값: s.zeroStockSkuCount },
    { 항목: '음수재고 SKU 수', 값: s.negativeStockSkuCount },
    { 항목: '기준일 미관측 SKU 수', 값: s.staleSkuCount },
    { 항목: '가장 오래된 재고 관측일', 값: s.oldestObservationDate ?? '' },
    { 항목: '가장 최근 재고 관측일', 값: s.newestObservationDate ?? '' },
    { 항목: '비교 가능한 SKU 수', 값: s.comparableSkuCount },
    { 항목: 'SKU별 순감소 합계', 값: s.observedDecrease ?? '비교 불가' },
    { 항목: 'SKU별 순증가 합계', 값: s.observedIncrease ?? '비교 불가' },
    { 항목: '기록된 입고량', 값: s.recordedInbound ?? '비교 불가' },
    { 항목: '입고 보정 추정 소진', 값: s.estimatedDepletion ?? '비교 불가' },
    { 항목: '집계 범위', 값: '최신 스냅샷 표시 대상 SKU. 원가 미상·음수재고 평가 제외. 추정 소진은 판매량 아님.' },
  ];
  for (const w of warehouseSummaries) {
    rows.push({ 항목: `[${w.warehouseName}] 관리 SKU / 평가 가능한 금액 / 무재고 / 음수재고`,
      값: `${w.skuCount} / ${w.snapshot.knownInventoryValue ?? '평가 불가'} / ${w.snapshot.zeroStockSkuCount} / ${w.snapshot.negativeStockSkuCount}` });
  }
  return rows;
}

export interface ExportEventInput {
  eventDate: string;
  warehouseName: string;
  productName: string | null;
  eventType: string;
  quantity: number | null;
  note: string;
  createdByName: string;
}

export function buildEventsSheetRows(events: ExportEventInput[]): Record<string, string | number>[] {
  return events.map((e) => ({
    일시: e.eventDate,
    창고: e.warehouseName,
    상품: e.productName ?? '(창고 전체)',
    유형: e.eventType,
    수량: e.quantity ?? '',
    내용: e.note,
    작성자: e.createdByName,
  }));
}
