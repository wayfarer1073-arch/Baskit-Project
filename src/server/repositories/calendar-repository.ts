import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';
import { closedDays, isShippingDay, type ClosedDays } from '@/domain/inventory/shipping-calendar';
import { listHolidayDateStrings } from '@/server/repositories/holiday-repository';

export type CalendarFor = (warehouseId: string) => ClosedDays;

/**
 * 창고별 영업 달력 — 등록 휴무일은 조직 공통이고, 주말·휴무일인데 그 창고에 실제로 재고 자료가 올라온 날은
 * 그 창고에서만 일한 날로 본다. 휴무일 업로드 설정을 꺼도 이미 올라온 날은 그대로 반영된다.
 */
export async function loadWarehouseCalendars(orgId: string): Promise<{ holidays: ClosedDays; calendarFor: CalendarFor }> {
  const holidays = new Set(await listHolidayDateStrings(orgId));
  const uploads = await prisma.inventorySnapshot.findMany({
    where: { status: 'ACTIVE', warehouse: { organizationId: orgId } },
    select: { warehouseId: true, snapshotDate: true },
    distinct: ['warehouseId', 'snapshotDate'],
  });
  const worked = new Map<string, string[]>();
  for (const u of uploads) {
    const date = dateOnlyToString(u.snapshotDate);
    if (isShippingDay(date, holidays)) continue;
    worked.set(u.warehouseId, [...(worked.get(u.warehouseId) ?? []), date]);
  }
  const base = closedDays(holidays);
  const byWarehouse = new Map([...worked].map(([warehouseId, dates]) => [warehouseId, closedDays(holidays, dates)]));
  return { holidays: base, calendarFor: (warehouseId) => byWarehouse.get(warehouseId) ?? base };
}
