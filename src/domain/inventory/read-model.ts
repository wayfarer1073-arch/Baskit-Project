import type { SkuAnalysis, InventoryValueBreakdown, PeriodComparison } from './types';

/** 품절로 인식된 SKU를 재고 표·품절 목록에 남겨 두는 기간(일). 이 기간이 지나면 자동으로 빠진다. */
export const SOLD_OUT_VISIBLE_DAYS = 180;

export interface SkuDescriptor {
  skuId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  option: string | null;
  barcode: string | null;
  location: string | null;
  /** 관리자가 SKU 상세에서 직접 지정한 위험/경고수량. null이면 자동계산을 쓴다. */
  manualDangerQty: number | null;
  manualWarningQty: number | null;
  expirationDate: string | null;
  /** 소비기한 위험 판정 일수. null이면 앱의 기본값(DEFAULT_EXPIRATION_RISK_DAYS)을 쓴다. */
  expirationRiskDays: number | null;
  /** 관리자가 직접 지정하는 '특수 관리 재고' 마커(정기 발주·B2B 납품·무상 제공 등). */
  isB2B: boolean;
  /** 특수 관리 이유·일정 메모. 없으면 빈 문자열. */
  specialNote?: string;
  /** 이 SKU가 이 창고에서 처음 관측된 날짜(최초 업로드로 인식된 시점). */
  firstSeenDate: string;
  /** 최신 업로드 목록에는 없지만 품절 인식 후 180일 유예기간 이내라 마지막 관측 그대로 노출 중인지. */
  isSoldOut: boolean;
  /** 품절로 인식된 날짜(그 날짜의 업로드 목록에서 처음 빠짐). isSoldOut이 false면 null. */
  soldOutDetectedDate: string | null;
  /** 설정 화면의 "SKU 추가 정보 관리" Excel 업로드로만 갱신되는 비유동 참고 정보. */
  eaPerBox: number | null;
  eaPerPallet: number | null;
  packagingBarcode: string | null;
  /** 발주 거래처(없으면 null)와 품목 발주 기준 예외. */
  /** 창고를 넘어 같은 품목으로 묶는 키(설정에서 직접 묶었을 때만). 없으면 상품코드로 묶는다. */
  mergeKey?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  reorderOverrides?: import('@/domain/reorder/reorder').PolicyLayer;
}

export interface DailyWarehouseTotal {
  date: string;
  warehouseId: string;
  totalAvailableStock: number;
  totalInventoryValue: number;
}

export interface InventoryRow {
  descriptor: SkuDescriptor;
  analysis: SkuAnalysis;
  valueBreakdown: InventoryValueBreakdown;
  periodComparison: PeriodComparison | null;
  /** 권장 발주일·발주량(소진 속도를 추정할 수 없으면 null). */
  reorder?: import('@/domain/reorder/reorder').ReorderSuggestion | null;
  /** 최근 30일 회전율 = 30일 소진량 ÷ 평균 재고. */
  turnover30?: { ratio: number | null; depletion: number; averageStock: number } | null;
  /** 기준일 재고 자료가 아직 없을 때 직전 자료로 추정한 오늘 재고(자료가 최신이면 없음). */
  nowcast?: import('./nowcast').Nowcast | null;
}
