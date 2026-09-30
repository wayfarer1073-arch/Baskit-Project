import { z } from 'zod';
import { isDateString } from '@/lib/date';

export const storeNoteSchema = z
  .object({
    eventType: z.enum(['INBOUND', 'RETURN', 'ADJUSTMENT', 'PROMOTION', 'SOLD_OUT', 'OTHER']),
    title: z.string().trim().max(100).nullable().default(null),
    note: z.string().trim().min(1, '내용을 입력하세요.').max(2000),
    startDate: z.string().refine(isDateString, '시작일을 확인하세요.'),
    endDate: z.string().refine(isDateString, '종료일을 확인하세요.'),
  })
  .refine((v) => v.startDate <= v.endDate, { message: '종료일이 시작일보다 빠를 수 없습니다.', path: ['endDate'] });
