/** 재고 파일 양식 타입·필드 목록 — 화면(클라이언트)에서도 쓰므로 엑셀 라이브러리를 불러오지 않는다. */
/**
 * 재고 파일 "양식" — 어느 시트의 몇 번째 행이 헤더이고, 어떤 열이 어떤 값인지. 업체(3PL)마다 엑셀 양식이
 * 달라서, 처음 올릴 때 자동으로 추천하고 사용자가 확인한 뒤 템플릿으로 저장해 다음부터 그대로 쓴다.
 * 열은 위치가 아니라 헤더 이름으로 기억한다 — 업체가 열 순서를 바꿔도 그대로 맞는다.
 */
export const LAYOUT_FIELDS = [
  'productCode',
  'productName',
  'normalStock',
  'unitCost',
  'totalCost',
  'expirationDate',
  'barcode',
  'eaPerBox',
  'eaPerPallet',
  'snapshotDate',
] as const;
export type LayoutField = (typeof LAYOUT_FIELDS)[number];
/** 상품명·정상재고만 꼭 필요하다. 상품코드가 없으면 상품명으로 품목을 구분하고 코드(A0001…)를 자동으로 붙인다. */
export const REQUIRED_LAYOUT_FIELDS: LayoutField[] = ['productName', 'normalStock'];
/** 재고 파일에서 함께 읽어 SKU 추가 정보(소비기한·바코드·입수량)로 반영하는 열. */
export const EXTRA_LAYOUT_FIELDS: LayoutField[] = ['expirationDate', 'barcode', 'eaPerBox', 'eaPerPallet'];
/** 상품코드 열을 쓰지 않을 때 자동으로 붙이는 코드의 머리글자와 자릿수(A0001, A0002 …). */
export const AUTO_CODE_PREFIX = 'A';
export const AUTO_CODE_DIGITS = 4;

export type DuplicateMode = 'sum' | 'skip';
/** 파일의 재고수량 단위 — 박스·팔레트면 SKU 추가 정보의 입수량으로 낱개(EA)로 바꾼다. */
export type StockUnit = 'EA' | 'BOX' | 'PLT';

export interface ImportLayout {
  /** null이면 첫 번째 시트. */
  sheetName: string | null;
  /** 0부터 센 헤더 행 번호. */
  headerRowIndex: number;
  /** 필드별 헤더 이름(없으면 null). */
  columns: Partial<Record<LayoutField, string | null>>;
  /** 같은 상품코드가 여러 행(로케이션·로트별)으로 나뉘어 있을 때 합산할지. */
  duplicateMode: DuplicateMode;
  /** 없으면 EA(낱개). */
  stockUnit?: StockUnit;
  /**
   * 재고가 0인 행을 어떻게 볼지. true(기본): 품절 — 관리 목록에서 빠지고 180일 동안 품절 목록에 보인다.
   * false: 관리 품목에서 제외 — 대시보드에 보이지 않는다. 어느 쪽이든 그 전 날짜로 조회하면 평소처럼 보인다.
   */
  zeroStockAsSoldOut?: boolean;
}

/** 재고 0인 행의 상태 — 품절 또는 관리 제외. 저장된 재고 행(extra.stockStatus)에도 남겨 날짜별로 판단한다. */
export type ZeroStockStatus = 'soldOut' | 'removed';

export type MatchConfidence = 'exact' | 'partial' | 'guess';
