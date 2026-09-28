import { z } from 'zod';

export const storeItemSchema = z.object({
  name: z.string().trim().min(1, '품목 이름을 입력하세요.').max(50),
  unit: z.string().trim().min(1, '발주 단위를 입력하세요.').max(10),
  leadTimeDays: z.number().int().min(0).max(60),
});
