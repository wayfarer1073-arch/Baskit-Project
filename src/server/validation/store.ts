import { z } from 'zod';

export const storeItemSchema = z.object({
  name: z.string().trim().min(1, '품목 이름을 입력하세요.').max(50),
  unit: z.string().trim().min(1, '발주 단위를 입력하세요.').max(10),
  leadTimeDays: z.number().int().min(0).max(60),
  supplierId: z.string().min(1).nullable().optional(),
});

const optionalText = (max: number) => z.string().trim().max(max).default('');

/** 매장 품목의 원가·참고 정보. 빈 칸은 지운다는 뜻이다. */
export const storeItemExtrasSchema = z.object({
  unitCost: z.number().min(0).max(1_000_000_000).nullable(),
  spec: optionalText(50),
  storage: optionalText(30),
  barcode: optionalText(50),
  packSize: z.number().int().min(1).max(1_000_000).nullable(),
  note: optionalText(200),
  expirationRiskDays: z.number().int().min(0).max(365).nullable(),
});

export const supplierSchema = z.object({
  name: z.string().trim().min(1, '발주처 이름을 입력하세요.').max(50),
  leadTimeDays: z.number().int('리드타임은 일 단위 정수로 입력하세요.').min(0).max(60),
  // 일일 재고 연동의 권장 발주 기준(비우면 워크스페이스 기본값).
  safetyDays: z.number().int().min(0).max(365).nullable().optional(),
  targetDays: z.number().int().min(1).max(365).nullable().optional(),
  minOrderQty: z.number().int().min(0).max(1_000_000).nullable().optional(),
  orderMultiple: z.number().int().min(1).max(100_000).nullable().optional(),
});
