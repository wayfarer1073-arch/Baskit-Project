import { z } from 'zod';
import { isDateString } from '@/lib/date';

const qty = z.number().int('수량은 정수로 입력하세요.').min(0, '수량은 0 이상이어야 합니다.').max(100_000_000);

export const countSchema = z.object({
  warehouseId: z.string().min(1),
  date: z.string().refine(isDateString, '날짜를 확인하세요.'),
  lines: z
    .array(
      z.object({
        productCode: z.string().trim().min(1, '상품코드(관리코드)를 입력하세요.').max(100),
        productName: z.string().trim().min(1, '상품명을 입력하세요.').max(200),
        quantity: qty,
        unitCost: z.number().min(0, '단위원가는 0 이상이어야 합니다.').max(1_000_000_000).nullable(),
        lots: z.array(z.object({ lot: z.string().trim().min(1, '롯트명을 입력하세요.').max(100), quantity: qty })).max(50),
      }),
    )
    .min(1, '센 상품을 하나 이상 입력하세요.')
    .max(500)
    .refine((lines) => new Set(lines.map((l) => l.productCode)).size === lines.length, '같은 상품코드가 두 번 들어 있어요. 한 줄로 합쳐 주세요.')
    .refine((lines) => lines.every((l) => new Set(l.lots.map((x) => x.lot)).size === l.lots.length), '한 상품 안에 같은 롯트가 두 번 들어 있어요.'),
});
