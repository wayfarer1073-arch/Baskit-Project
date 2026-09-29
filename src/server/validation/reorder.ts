import { z } from 'zod';

const days = z.number().int().min(0).max(365).nullable();
const qty = z.number().int().min(0).max(1_000_000).nullable();

export const skuReorderSchema = z.object({
  supplierId: z.string().min(1).nullable(),
  reorderLeadTimeDays: days,
  reorderSafetyDays: days,
  reorderTargetDays: z.number().int().min(1).max(365).nullable(),
  reorderMinQty: qty,
  reorderMultiple: z.number().int().min(1).max(100_000).nullable(),
});
