import { z } from 'zod';

export const storeItemSchema = z.object({
  name: z.string().trim().min(1, '품목 이름을 입력하세요.').max(50),
  unit: z.string().trim().min(1, '발주 단위를 입력하세요.').max(10),
  leadTimeDays: z.number().int().min(0).max(60),
  supplierId: z.string().min(1).nullable().optional(),
});

export const supplierSchema = z.object({
  name: z.string().trim().min(1, '발주처 이름을 입력하세요.').max(50),
  leadTimeDays: z.number().int('리드타임은 일 단위 정수로 입력하세요.').min(0).max(60),
});
