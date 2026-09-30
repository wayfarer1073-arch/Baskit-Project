import { z } from 'zod';
import { SCHEDULE_COLORS } from '@/lib/schedule-colors';
import { isDateString } from '@/lib/date';

export const scheduleSchema = z
  .object({
    eventType: z.enum(['INBOUND', 'RETURN', 'ADJUSTMENT', 'PROMOTION', 'SOLD_OUT', 'OTHER']),
    title: z.string().trim().min(1, '제목을 입력하세요.').max(100),
    startDate: z.string().refine(isDateString, '시작일을 확인하세요.'),
    endDate: z.string().refine(isDateString, '종료일을 확인하세요.'),
    color: z.enum(SCHEDULE_COLORS),
    note: z.string().max(2000).default(''),
    skuIds: z.array(z.string().min(1)).max(200).default([]),
    storeItemIds: z.array(z.string().min(1)).max(200).default([]),
  })
  .refine((v) => v.startDate <= v.endDate, { message: '종료일이 시작일보다 빠를 수 없습니다.', path: ['endDate'] });
