import type { PeriodicEstimate } from './periodic-count';
import type { StoreExpiration } from './store-expiration';
import type { CoverageAnalysis, SalesTrend } from './sales-coverage';

export interface PeriodicRow {
  skuId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  estimate: PeriodicEstimate;
}

/** 실사 때 롯트별로 센 수량. 합계가 그 SKU의 실사 수량이 된다. */
export interface CountLot {
  lot: string;
  quantity: number;
}

/** 직접 입력 화면의 재고 현황 한 줄. */
export interface CountSheetRow {
  skuId: string;
  productCode: string;
  productName: string;
  /** 지금 품절로 표시된 상품(최근 엑셀 전체 실사에서 빠짐). */
  soldOut: boolean;
  /** SKU에 기억된 단위원가 — 이 날짜 줄에 원가가 없을 때 저장에 쓴다. */
  unitCost: number | null;
  /** 이 날짜에 기록된 실사(없으면 null). */
  day: { quantity: number; source: 'manual' | 'excel'; lots: CountLot[]; unitCost: number | null } | null;
  /** 이 날짜보다 앞선 가장 가까운 실사. */
  previous: { date: string; quantity: number; lots: CountLot[] } | null;
}

export interface PeriodicCountEntry {
  date: string;
  quantity: number;
  unitCost: number | null;
  lots: CountLot[];
  /** 직접 입력으로 기록된 실사인지(아니면 엑셀 업로드). */
  manual: boolean;
}

export interface PeriodicSkuDetail extends PeriodicRow {
  unitCost: number | null;
  counts: PeriodicCountEntry[];
  inbounds: { date: string; quantity: number }[];
  recountDays: number;
  stockoutSoonDays: number;
}

/** InventoryItem.extra에 저장된 롯트 목록을 안전하게 읽는다(엑셀 업로드 행에는 없다). */
export function readLots(extra: unknown): CountLot[] {
  if (!extra || typeof extra !== 'object' || !('lots' in extra) || !Array.isArray((extra as { lots: unknown }).lots)) return [];
  return (extra as { lots: unknown[] }).lots.flatMap((l) =>
    l && typeof l === 'object' && typeof (l as CountLot).lot === 'string' && typeof (l as CountLot).quantity === 'number'
      ? [{ lot: (l as CountLot).lot, quantity: (l as CountLot).quantity }]
      : [],
  );
}

export interface StoreCoverageRow {
  itemId: string;
  name: string;
  unit: string;
  /** 실제로 쓰는 리드타임(발주처 값 우선). */
  leadTimeDays: number;
  supplierName: string | null;
  analysis: CoverageAnalysis;
  /** 지금 있는 발주분 중 소비기한을 적은 것의 가장 이른 소비기한. 적지 않았으면 null(따라가지 않음). */
  expiration: StoreExpiration | null;
}

/** 매장 품목의 원가·소비기한·참고 정보 — 설정의 매장 발주 예측 탭에서 고치고, 품목 상세에서 본다. */
export interface StoreItemExtras {
  itemId: string;
  /** 발주 단위 하나의 원가. 등록하지 않았으면 null. */
  unitCost: number | null;
  spec: string;
  storage: string;
  barcode: string;
  /** 발주 단위 하나에 든 낱개 수(입수량). */
  packSize: number | null;
  note: string;
  /** 발주 때 적은 소비기한이 이 일수 안으로 들어오면 임박으로 본다. null이면 매장 기본값. */
  expirationRiskDays: number | null;
}

export interface StoreDashboardData {
  rows: StoreCoverageRow[];
  sales: SalesTrend;
  /** 가장 최근에 매출이 입력된 날짜. 입력이 밀렸는지 알려주는 데 쓴다. */
  lastSalesDate: string | null;
  /** 설정의 '발주 확인 기준'(%) — 진행 막대의 확인 구간 표시에 쓴다. */
  checkRemainingPct: number;
}

export interface StoreItemDetail extends StoreCoverageRow {
  /** 매장 품목 가상 창고 id — 메모/이벤트를 이 창고의 SKU 기록으로 남긴다. */
  warehouseId: string;
  extras: StoreItemExtras;
  orders: OrderEntryRow[];
  checkRemainingPct: number;
}

/** 발주 입력 화면에서 "과거 기록상 이 수량이면 얼마를 감당했는지"를 바로 계산하기 위한 품목별 학습값. */
export interface StoreItemLearning {
  id: string;
  name: string;
  unit: string;
  leadTimeDays: number;
  itemLeadTimeDays: number;
  supplierId: string | null;
  supplierName: string | null;
  /** 지금 발주분의 예상 잔량 — 재발주할 때 잔량 입력의 기본값으로 쓴다. */
  estimatedRemainingUnits: number | null;
  /** 이전 발주에 소비기한을 적은 적이 있는 품목 — 발주 입력에서 소비기한 칸을 먼저 펼쳐 둔다. */
  tracksExpiration: boolean;
  orderCount: number;
  salesPerUnit: number | null;
  learnedCycles: number;
}

export interface OrderEntryRow {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  date: string;
  quantity: number;
  coverageAmount: number | null;
  leftoverQuantity: number | null;
  expirationDate: string | null;
  createdByName: string;
}

export interface SalesEntryRow {
  date: string;
  amount: number;
}

export interface SupplierRow {
  id: string;
  name: string;
  leadTimeDays: number;
  itemCount: number;
}

// ── Easy Count(매장 재고 기록) ──

export interface EasyCountEntry {
  fullUnits: number;
  openedPercent: number | null;
}

export interface EasyCountItem {
  id: string;
  name: string;
  unit: string;
  supplierName: string | null;
  /** 이 날짜에 이미 적은 값(있으면 입력칸에 채운다). */
  current: EasyCountEntry | null;
  /** 이 날짜 전 마지막 기록. */
  previous: (EasyCountEntry & { date: string }) | null;
  /** 기록이 한 번도 없을 때 대신 보여 주는, 이 날짜까지의 가장 최근 발주. */
  lastOrder: { date: string; quantity: number } | null;
}

export interface EasyCountLine {
  itemId: string;
  /** 둘 다 null이면 이 날짜의 기록을 지운다. */
  fullUnits: number | null;
  openedPercent: number | null;
}

// ── 메뉴·레시피(레시피 기반 소모량) ──

export interface RecipeItemRow {
  id: string;
  name: string;
  unit: string;
  /** 1단위에 든 양(레시피 단위, 예: 1봉 = 1000 g). */
  contentPerUnit: number | null;
  contentUnit: string | null;
}

export interface StoreMenuRow {
  id: string;
  name: string;
  code: string | null;
  lines: { itemId: string; quantity: number }[];
  /** 최근 7일 판매 수. */
  soldRecent: number;
}

export type MenuMatch = { kind: 'menu'; menuId: string; via: 'code' | 'name' | 'alias' } | { kind: 'ignore' } | { kind: 'none' };

export interface MenuSalesPreviewName {
  name: string;
  code: string | null;
  quantity: number;
  amount: number | null;
  match: MenuMatch;
}

export interface MenuSalesPreview {
  headerRowIndex: number;
  headers: string[];
  columns: Partial<Record<import('@/domain/excel/menu-sales-fields').MenuSalesField, string>>;
  /** 열을 어떻게 정했는지 — 저장한 양식 / 기본 인식(OKPOS 등) / 직접 지정 / 못 찾음. */
  source: 'template' | 'auto' | 'manual' | 'none';
  templateName: string | null;
  /** 파일 위쪽 조회기간이 하루면 그 날짜, 여러 날이면 range. */
  periodDate: string | null;
  periodRange: [string, string] | null;
  /** 날짜를 알 수 없는 줄이 있어 날짜를 골라야 하는지. */
  needsDate: boolean;
  rows: { date: string | null; code: string | null; name: string; quantity: number; amount: number | null }[];
  dates: string[];
  skipped: number;
  missing: import('@/domain/excel/menu-sales-fields').MenuSalesField[];
  names: MenuSalesPreviewName[];
  /** 머리글 행을 직접 고를 때 보여 줄 파일 윗부분. */
  topRows: string[][];
}

export interface RecipeOverviewRow {
  item: RecipeItemRow;
  /** 기간 소모량(품목 단위)과 레시피 단위 소모량. */
  units: number;
  content: number | null;
  dailyAverage: number | null;
  estimate: import('@/domain/segments/recipe-usage').StockEstimate | null;
}

export interface RecipeOverview {
  from: string;
  to: string;
  asOfDate: string;
  rows: RecipeOverviewRow[];
  menusWithoutRecipe: { menuId: string; name: string; quantity: number }[];
  /** 기간 중 메뉴 판매가 있는 날 수와 마지막 판매 기록일. */
  salesDays: number;
  lastSalesDate: string | null;
}

export interface LossReportRow {
  item: RecipeItemRow;
  /** 단가(원) — 등록돼 있지 않으면 null. */
  unitCost: number | null;
  loss: import('@/domain/segments/loss-report').CountIntervalLoss;
}

export interface LossReport {
  asOfDate: string;
  /** 레시피에 쓰이고 Easy Count를 두 번 이상 센 품목 — 가장 최근 두 실사 사이. */
  rows: LossReportRow[];
  /** 레시피에 쓰이지만 아직 한 번 이하로 센 품목 수 — 두 번째 실사부터 비교할 수 있다. */
  waiting: number;
  /** 레시피에 쓰이는 품목 수. */
  inRecipes: number;
}
