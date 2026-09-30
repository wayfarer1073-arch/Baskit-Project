/** 설정/업로드 화면의 "샘플파일 다운로드" 버튼이 내려주는 업로드 양식. 각 파서의 헤더 별칭 중
 * 가장 표준적인 이름을 헤더로 쓰고, 실제로 채워 넣을 형태를 보여주는 예시 행 2개를 둔다. */

export const TEMPLATE_TYPES = ['inventory', 'expiration', 'packaging', 'sales'] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export interface TemplateSheet {
  fileName: string;
  headers: string[];
  rows: (string | number)[][];
}

const TEMPLATE_BUILDERS: Record<TemplateType, () => TemplateSheet> = {
  inventory: () => ({
    fileName: '재고_업로드_양식.xlsx',
    headers: ['상품코드', '상품명', '정상재고', '원가', '원가합'],
    rows: [
      ['00001', '샘플상품 A 200g', 120, 3500, 420000],
      ['00002', '샘플상품 B 500ml', 80, '', ''],
    ],
  }),
  expiration: () => ({
    fileName: '소비기한_업로드_양식.xlsx',
    headers: ['상품코드', '상품명', '로트', '소비기한'],
    rows: [
      ['00001', '샘플상품 A 200g', 'A', '2026-12-31'],
      ['00002', '샘플상품 B 500ml', '', '2027-03-15'],
    ],
  }),
  packaging: () => ({
    fileName: 'SKU_추가정보_업로드_양식.xlsx',
    headers: ['상품코드', '상품명', 'EA/BOX', 'EA/PLT', '상품바코드'],
    rows: [
      ['00001', '샘플상품 A 200g', 24, 480, '8801234567890'],
      ['00002', '샘플상품 B 500ml', 12, 240, '8801234567891'],
    ],
  }),
  sales: () => ({
    fileName: '매출_업로드_양식.xlsx',
    headers: ['날짜', '매출'],
    rows: [
      ['2026-09-01', 1250000],
      ['2026-09-02', 980000],
    ],
  }),
};

export function buildTemplateSheet(type: TemplateType): TemplateSheet {
  return TEMPLATE_BUILDERS[type]();
}
