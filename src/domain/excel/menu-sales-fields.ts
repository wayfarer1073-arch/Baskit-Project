/** 메뉴별 판매 파일의 열 — 화면(열 고르기)과 서버(파서)가 함께 쓴다. 엑셀 라이브러리를 끌어오지 않도록 따로 둔다. */

export const MENU_SALES_FIELDS = ['menuName', 'quantity', 'menuCode', 'amount', 'date'] as const;
export type MenuSalesField = (typeof MENU_SALES_FIELDS)[number];
export const REQUIRED_MENU_SALES_FIELDS: readonly MenuSalesField[] = ['menuName', 'quantity'];

/** 열 이름 별칭 — 앞쪽이 우선(예: 실매출액과 총매출액이 함께 있으면 실매출액). */
export const MENU_SALES_ALIASES: Record<MenuSalesField, string[]> = {
  menuName: ['상품명', '메뉴명', '품목명', '상품', '메뉴', '품명', 'menu', 'item', 'product', 'productname'],
  quantity: ['판매수량', '수량', '판매량', '매출수량', '판매개수', '개수', 'qty', 'quantity'],
  menuCode: ['상품코드', '메뉴코드', '품목코드', '코드', 'code', 'productcode'],
  amount: ['실매출액', '실매출', '순매출액', '순매출', '총매출액', '총매출', '매출액', '판매금액', '매출', '금액', 'amount', 'sales'],
  date: ['영업일자', '판매일자', '매출일자', '거래일자', '일자', '날짜', '영업일', 'date'],
};

/** 머리글 이름으로 고른 열(저장하는 양식도 이 모양). */
export interface MenuSalesLayout {
  headerRowIndex: number;
  columns: Partial<Record<MenuSalesField, string>>;
}
