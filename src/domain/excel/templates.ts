/**
 * 설정/업로드 화면의 "샘플파일 다운로드" 버튼이 내려주는 업로드 양식.
 *
 * - 첫 시트: 헤더(파서가 알아보는 가장 표준적인 이름) + 바로 아래 두 줄(작성 방법 행, 예시 행).
 *   두 행에는 '[작성 방법' / '[예시'로 시작하는 칸이 있어, 지우지 않고 올려도 파서가 건너뛴다.
 * - 둘째 시트 '작성 가이드': 열마다 필수 여부·입력 방법·예시와 작성 시 주의사항.
 * 재고 양식은 양식 설정에서 고를 수 있는 열을 모두 담는다 — 값을 적지 않은 열은 업로드할 때 자동으로 읽지 않는다.
 */
import { EXAMPLE_ROW_MARKERS } from './example-rows';

export const TEMPLATE_TYPES = ['inventory', 'expiration', 'packaging', 'sales'] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

export interface TemplateColumn {
  header: string;
  required: boolean;
  /** 헤더 아래 작성 방법 행과 가이드 시트에 쓰는 입력 방법. */
  how: string;
  /** 예시 행의 값. */
  example: string | number;
  /** 엑셀 열 너비(글자 수). */
  width: number;
}

export interface TemplateSheet {
  fileName: string;
  sheetName: string;
  headers: string[];
  /** 헤더 바로 아래의 작성 방법 행과 예시 행. */
  rows: (string | number)[][];
  columnWidths: number[];
  guide: { notes: string[]; columns: TemplateColumn[] };
}

export const GUIDE_SHEET_NAME = '작성 가이드';
const HOW_MARKER = `${EXAMPLE_ROW_MARKERS[0]}·삭제]`;
const EXAMPLE_MARKER = `${EXAMPLE_ROW_MARKERS[1]}·삭제]`;

const COMMON_NOTES = [
  `'업로드양식' 시트의 1행(헤더)은 그대로 두고, 바로 아래 ${HOW_MARKER}·${EXAMPLE_MARKER} 두 행을 지운 뒤 2행부터 실제 값을 적어 주세요.`,
  '두 행을 깜빡하고 지우지 않아도 업로드할 때 자동으로 건너뛰어요(실제 품목으로 저장되지 않아요).',
  '한 번에 올릴 수 있는 행은 헤더를 빼고 최대 500행이에요.',
  '날짜는 2026-12-31, 2026.12.31, 2026/12/31, 20261231 중 편한 형식으로 적으면 돼요. 엑셀 날짜 서식도 그대로 읽어요.',
  '숫자 칸에는 숫자만 적어 주세요. 천 단위 쉼표(1,200)와 끝의 "원"은 괜찮아요.',
];

function sheetFrom(fileName: string, columns: TemplateColumn[], extraNotes: string[], exampleRow: (string | number)[]): TemplateSheet {
  return {
    fileName,
    sheetName: '업로드양식',
    headers: columns.map((c) => c.header),
    rows: [columns.map((c, i) => (i === 0 ? `${HOW_MARKER} ${c.how}` : c.how)), exampleRow],
    columnWidths: columns.map((c) => c.width),
    guide: { notes: [...COMMON_NOTES, ...extraNotes], columns },
  };
}

const INVENTORY_COLUMNS: TemplateColumn[] = [
  { header: '상품코드', required: false, how: '선택 · 영문/숫자 코드. 비우면 상품명으로 구분하고 A0001부터 자동으로 붙여요', example: '00001', width: 30 },
  { header: '상품명', required: true, how: '필수 · 옵션까지 한 칸에', example: '샘플상품 A 200g', width: 30 },
  { header: '정상재고', required: true, how: '필수 · 판매 가능한 수량(정수)', example: 120, width: 18 },
  { header: '원가', required: false, how: '선택 · 낱개 1개 원가(숫자)', example: 3500, width: 16 },
  { header: '원가합', required: false, how: '선택 · 재고 × 원가 합계(숫자)', example: 420000, width: 18 },
  { header: '소비기한', required: false, how: '선택 · 2026-12-31 형식. 로트가 여럿이면 행을 나눠 적기', example: '2026-12-31', width: 26 },
  { header: '상품바코드', required: false, how: '선택 · 숫자 그대로(앞자리 0은 텍스트 서식으로)', example: '8801234567890', width: 24 },
  { header: 'EA/BOX', required: false, how: '선택 · 한 박스에 든 낱개 수(정수)', example: 24, width: 16 },
  { header: 'EA/PLT', required: false, how: '선택 · 한 팔레트에 든 낱개 수(정수)', example: 480, width: 16 },
  { header: '기준일', required: false, how: '선택 · 이 재고의 기준 날짜(업로드하는 날짜와 같게)', example: '2026-10-01', width: 24 },
];

const TEMPLATE_BUILDERS: Record<TemplateType, () => TemplateSheet> = {
  inventory: () =>
    sheetFrom(
      '재고_업로드_양식.xlsx',
      INVENTORY_COLUMNS,
      [
        '상품명·정상재고만 꼭 필요해요. 쓰지 않는 열은 비워 두면 업로드할 때 자동으로 읽지 않아요(열을 지워도 돼요).',
        '값을 적은 열은 업로드 화면의 “양식 설정 > 읽을 열 고르기”에서 자동으로 체크돼요. 읽히지 않게 하려면 거기서 체크를 해제하면 돼요.',
        '같은 상품코드가 여러 행(로케이션·로트별)이면 재고를 합산해요.',
      ],
      INVENTORY_COLUMNS.map((c, i) => (i === 1 ? `${EXAMPLE_MARKER} ${c.example}` : c.example)),
    ),
  expiration: () =>
    sheetFrom(
      '소비기한_업로드_양식.xlsx',
      [
        { header: '상품코드', required: true, how: '필수 · 재고 파일과 같은 상품코드', example: '00001', width: 30 },
        { header: '상품명', required: false, how: '선택 · 확인용', example: '샘플상품 A 200g', width: 30 },
        { header: '로트', required: false, how: '선택 · 비우면 소비기한 빠른 순으로 A, B, C…', example: 'A', width: 24 },
        { header: '소비기한', required: true, how: '필수 · 2026-12-31 형식', example: '2026-12-31', width: 22 },
      ],
      ['한 행이 한 로트예요. 같은 상품의 로트가 여러 개면 행을 나눠 적어 주세요.'],
      ['00001', `${EXAMPLE_MARKER} 샘플상품 A 200g`, 'A', '2026-12-31'],
    ),
  packaging: () =>
    sheetFrom(
      'SKU_추가정보_업로드_양식.xlsx',
      [
        { header: '상품코드', required: true, how: '필수 · 재고 파일과 같은 상품코드', example: '00001', width: 30 },
        { header: '상품명', required: false, how: '선택 · 확인용', example: '샘플상품 A 200g', width: 30 },
        { header: 'EA/BOX', required: false, how: '선택 · 한 박스에 든 낱개 수(정수)', example: 24, width: 18 },
        { header: 'EA/PLT', required: false, how: '선택 · 한 팔레트에 든 낱개 수(정수)', example: 480, width: 18 },
        { header: '상품바코드', required: false, how: '선택 · 숫자 그대로(앞자리 0은 텍스트 서식으로)', example: '8801234567890', width: 24 },
      ],
      ['비워 둔 칸은 기존 값을 바꾸지 않아요. 값이 있는 칸만 반영해요.'],
      ['00001', `${EXAMPLE_MARKER} 샘플상품 A 200g`, 24, 480, '8801234567890'],
    ),
  sales: () =>
    sheetFrom(
      '매출_업로드_양식.xlsx',
      [
        { header: '날짜', required: true, how: '필수 · 2026-09-01 형식. 오늘 이후 날짜는 건너뛰어요', example: '2026-09-01', width: 30 },
        { header: '매출', required: true, how: '필수 · 그날 매출 합계(숫자)', example: 1250000, width: 22 },
        { header: '비고', required: false, how: '선택 · 메모(읽지 않아요)', example: '', width: 26 },
      ],
      ['같은 날짜가 여러 번 나오면 마지막 값을 써요.'],
      ['2026-09-01', 1250000, `${EXAMPLE_MARKER} 이 행은 지우고 작성`],
    ),
};

export function buildTemplateSheet(type: TemplateType): TemplateSheet {
  return TEMPLATE_BUILDERS[type]();
}

/** '작성 가이드' 시트 내용(행 배열). */
export function buildGuideRows(sheet: TemplateSheet): string[][] {
  return [
    ['작성 가이드'],
    [],
    ...sheet.guide.notes.map((note, i) => [`${i + 1}. ${note}`]),
    [],
    ['열 이름', '필수 여부', '입력 방법', '예시'],
    ...sheet.guide.columns.map((c) => [c.header, c.required ? '필수' : '선택', c.how.replace(/^(필수|선택) · /, ''), String(c.example)]),
  ];
}
