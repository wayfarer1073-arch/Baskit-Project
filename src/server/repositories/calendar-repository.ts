import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';
import { closedDays, detectClosedDays, isShippingDay, type ClosedDays } from '@/domain/inventory/shipping-calendar';
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
  const detected = await detectWarehouseClosedDays(orgId, closedDays(holidays));
  const ids = new Set([...worked.keys(), ...detected.keys()]);
  const byWarehouse = new Map([...ids].map((warehouseId) => [warehouseId, closedDays(holidays, worked.get(warehouseId) ?? [], detected.get(warehouseId) ?? [])]));
  return { holidays: base, calendarFor: (warehouseId) => byWarehouse.get(warehouseId) ?? base };
}

/** 자료로 알아낸 창고별 쉬는 날을 다시 볼 기간(일). */
const CLOSED_DETECTION_LOOKBACK_DAYS = 400;

/** 창고·날짜별로 '전날 대비 재고가 바뀐 품목 수 / 이틀 다 있던 품목 수'를 세어 멈춘 평일을 찾는다. */
async function detectWarehouseClosedDays(orgId: string, holidays: ClosedDays): Promise<Map<string, string[]>> {
  const since = new Date(Date.now() - CLOSED_DETECTION_LOOKBACK_DAYS * 86_400_000);
  const rows = await prisma.$queryRaw<{ warehouseId: string; date: Date; present: bigint; changed: bigint }[]>`
    WITH obs AS (
      SELECT s."warehouseId", s."snapshotDate", i."normalStock",
             LAG(i."normalStock") OVER (PARTITION BY i."skuId" ORDER BY s."snapshotDate") AS prev
      FROM inventory_items i
      JOIN inventory_snapshots s ON s.id = i."snapshotId"
      JOIN warehouses w ON w.id = s."warehouseId"
      WHERE s.status = 'ACTIVE' AND w."organizationId" = ${orgId} AND s."snapshotDate" >= ${since}
    )
    SELECT "warehouseId", "snapshotDate" AS date,
           COUNT(*) FILTER (WHERE prev IS NOT NULL) AS present,
           COUNT(*) FILTER (WHERE prev IS NOT NULL AND "normalStock" <> prev) AS changed
    FROM obs GROUP BY "warehouseId", "snapshotDate"`;
  const byWarehouse = new Map<string, { date: string; present: number; changed: number }[]>();
  for (const r of rows) {
    const list = byWarehouse.get(r.warehouseId) ?? [];
    list.push({ date: dateOnlyToString(r.date), present: Number(r.present), changed: Number(r.changed) });
    byWarehouse.set(r.warehouseId, list);
  }
  return new Map([...byWarehouse].map(([warehouseId, stats]) => [warehouseId, detectClosedDays(stats, holidays)]));
}
