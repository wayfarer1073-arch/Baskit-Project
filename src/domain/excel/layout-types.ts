/** 재고 파일 양식 타입·필드 목록 — 화면(클라이언트)에서도 쓰므로 엑셀 라이브러리를 불러오지 않는다. */
/**
 * 재고 파일 "양식" — 어느 시트의 몇 번째 행이 헤더이고, 어떤 열이 어떤 값인지. 업체(3PL)마다 엑셀 양식이
 * 달라서, 처음 올릴 때 자동으로 추천하고 사용자가 확인한 뒤 템플릿으로 저장해 다음부터 그대로 쓴다.
 * 열은 위치가 아니라 헤더 이름으로 기억한다 — 업체가 열 순서를 바꿔도 그대로 맞는다.
 */
export const LAYOUT_FIELDS = ['productCode', 'productName', 'normalStock', 'unitCost', 'totalCost', 'snapshotDate'] as const;
export type LayoutField = (typeof LAYOUT_FIELDS)[number];
export const REQUIRED_LAYOUT_FIELDS: LayoutField[] = ['productCode', 'productName', 'normalStock'];

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
}

export type MatchConfidence = 'exact' | 'partial' | 'guess';
