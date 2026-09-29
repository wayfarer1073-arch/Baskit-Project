import { z } from 'zod';
import { LAYOUT_FIELDS, type ImportLayout, type LayoutField } from '@/domain/excel/layout-types';

const header = z.string().trim().min(1).max(200).nullable().optional();

export const importLayoutSchema = z.object({
  sheetName: z.string().max(200).nullable(),
  headerRowIndex: z.number().int().min(0).max(50),
  // 필드 목록에서 만들어 새 필드가 생겨도 검증에서 조용히 빠지지 않게 한다.
  columns: z.object(Object.fromEntries(LAYOUT_FIELDS.map((f) => [f, header])) as Record<LayoutField, typeof header>),
  duplicateMode: z.enum(['sum', 'skip']),
  stockUnit: z.enum(['EA', 'BOX', 'PLT']).optional(),
  zeroStockAsSoldOut: z.boolean().optional(),
});

export const codeAliasSchema = z.object({
  warehouseId: z.string().min(1),
  externalCode: z.string().trim().min(1, '파일의 상품코드를 입력하세요.').max(100),
  skuId: z.string().min(1, '연결할 상품을 고르세요.'),
});

export const templateNameSchema = z.string().trim().min(1, '템플릿 이름을 입력하세요.').max(60);

/** multipart 폼의 JSON 문자열 필드를 양식으로. 없으면 undefined, 형식이 틀리면 null. */
export function parseLayoutField(value: FormDataEntryValue | null): ImportLayout | undefined | null {
  if (typeof value !== 'string' || value === '') return undefined;
  try {
    const parsed = importLayoutSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
