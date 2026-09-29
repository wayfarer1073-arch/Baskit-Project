import { z } from 'zod';
import type { ImportLayout } from '@/domain/excel/layout';

const header = z.string().trim().min(1).max(200).nullable().optional();

export const importLayoutSchema = z.object({
  sheetName: z.string().max(200).nullable(),
  headerRowIndex: z.number().int().min(0).max(50),
  columns: z.object({ productCode: header, productName: header, normalStock: header, unitCost: header, totalCost: header, snapshotDate: header }),
  duplicateMode: z.enum(['sum', 'skip']),
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
