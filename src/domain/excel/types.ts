/** Excel 임포트 도메인 타입. 시트 헤더명을 내부 필드로 매핑해 컬럼 순서 변화에 영향받지 않게 한다. */

export const CANONICAL_FIELDS = [
  'productCode',
  'productName',
  'unitCost',
  'totalCost',
  'normalStock',
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

/** 헤더 검증에 반드시 필요한 컬럼(없으면 파일 전체를 저장하지 않는다) */
export const REQUIRED_FIELDS: CanonicalField[] = [
  'productCode',
  'productName',
  'normalStock',
];

export const NUMERIC_FIELDS: CanonicalField[] = [
  'unitCost',
  'totalCost',
  'normalStock',
];

/** 양식과 컬럼 순서에 상관없이 최소 재고 필드를 찾기 위한 헤더 별칭. */
export const HEADER_ALIASES: Record<CanonicalField, string[]> = {
  productCode: ['상품코드', '상품 코드', '품목코드', '품목 코드', '품번', 'SKU', 'SKU코드', 'SKU 코드'],
  productName: ['상품명', '상품 명', '제품명', '제품 명', '품목명', '품목 명'],
  unitCost: ['원가', '단가', '단위원가', '단위 원가', '매입가', '매입단가'],
  totalCost: ['원가합', '원가 합', '원가합계', '원가 합계', '총원가', '원가총액', '재고원가', '재고금액'],
  // "정상재고" 계열을 우선하고, "가용재고" 계열은 가장 낮은 우선순위로 둔다 — 정상재고 열이
  // 없을 때만 가용재고 열을 정상재고로 인식하고, 둘 다 있으면 정상재고 값만 쓴다
  // (buildHeaderMap이 이 배열 순서를 우선순위로 삼는다).
  normalStock: ['정상재고', '정상 재고', '재고수량', '재고 수량', '현재고', '현재 재고', '재고', '가용재고', '가용 재고', '가용수량', '가용 수량'],
};

export interface ParsedInventoryRow {
  rowNumber: number; // 원본 시트 상 행 번호(헤더 제외, 1부터) - 오류 메시지용
  productCode: string;
  productName: string;
  option: string | null;
  barcode: string | null;
  unitCost: number;
  /** 업로드 원가합. null이면 유효 원가 × 정상재고로 계산한다. */
  totalCost: number | null;
  normalStock: number;
  availableStock: number;
  incomingStock: number;
  defectiveStock: number;
  warningQty: number;
  dangerQty: number;
  location: string | null;
  category: string | null;
  /** 호환성을 위한 빈 객체. 최소 업로드에서는 불필요한 원본 열을 저장하지 않는다. */
  extra: Record<string, unknown>;
  /** 원가 헤더가 없거나 해당 셀이 비어 있어 이전 SKU 원가를 이어받아야 하는지 여부 */
  costMissing: boolean;
  /** 상품코드 열 없이 올라와 상품명으로 구분한 행 — 창고 기준으로 코드를 붙이기 전까지 productCode는 임시값이다. */
  autoCode?: boolean;
  /** 재고 파일에 함께 적힌 소비기한(여러 행이 합쳐지면 모든 날짜). */
  expirationDates?: string[];
  /** 재고 파일에 함께 적힌 입수량. */
  eaPerBox?: number | null;
  eaPerPallet?: number | null;
}

export type IssueLevel = 'ERROR' | 'WARNING';

export interface ValidationIssue {
  level: IssueLevel;
  code: string;
  message: string;
  rowNumber?: number;
  column?: string;
}

export interface ParseResult {
  rows: ParsedInventoryRow[];
  headerMap: Partial<Record<CanonicalField, string>>;
  issues: ValidationIssue[];
  /** 파일 안 '기준일' 열에서 읽은 날짜들(열이 없으면 빈 배열). */
  fileDates: string[];
  /** 실제로 쓴 양식(시트·헤더 행·열). 파일이 비어 있으면 없음. */
  layout?: import('./layout').ImportLayout;
}
