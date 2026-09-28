import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';
import { isScheduleColor, type ScheduleColor } from '@/lib/schedule-colors';
import type { ScheduleRow } from '@/domain/events/schedule-types';

export type { ScheduleRow, ScheduleEventRow } from '@/domain/events/schedule-types';

/**
 * 업로드 캘린더에 표시할 전체 일정 목록. 이벤트가 하나도 안 남은(전부 삭제된) 일정은 굳이
 * 정리하지 않고 그냥 결과에서만 걸러낸다 — 같은 제목·기간으로 다시 등록되면 남아있던 색상을
 * 그대로 재사용하기 위해 행 자체는 지우지 않는다.
 */
export async function listSchedules(orgId: string): Promise<ScheduleRow[]> {
  const schedules = await prisma.eventSchedule.findMany({
    where: { organizationId: orgId },
    orderBy: { startDate: 'asc' },
    include: {
      events: {
        where: { isDeleted: false },
        include: {
          sku: { select: { productCode: true, currentProductName: true } },
          warehouse: { select: { code: true, name: true } },
        },
      },
    },
  });

  return schedules
    .filter((s) => s.events.length > 0)
    .map((s) => ({
      id: s.id,
      eventType: s.eventType,
      title: s.title,
      startDate: dateOnlyToString(s.startDate),
      endDate: dateOnlyToString(s.endDate),
      color: s.color,
      events: s.events.map((e) => ({
        id: e.id,
        skuId: e.skuId,
        warehouseId: e.warehouseId,
        warehouseCode: e.warehouse.code,
        warehouseName: e.warehouse.name,
        productCode: e.sku?.productCode ?? null,
        productName: e.sku?.currentProductName ?? null,
        note: e.note,
        quantity: e.quantity,
      })),
    }));
}

export type SetScheduleColorResult = { ok: true } | { ok: false; error: string };

export async function setScheduleColor(orgId: string, id: string, color: string): Promise<SetScheduleColorResult> {
  if (!isScheduleColor(color)) return { ok: false, error: '허용되지 않는 색상입니다.' };
  const result = await prisma.eventSchedule.updateMany({ where: { id, organizationId: orgId }, data: { color: color satisfies ScheduleColor } });
  if (result.count === 0) return { ok: false, error: '일정을 찾을 수 없습니다.' };
  return { ok: true };
}
