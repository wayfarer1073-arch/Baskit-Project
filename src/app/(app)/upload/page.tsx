import { ensureSegmentWarehouse, listWarehouses } from '@/server/repositories/warehouse-repository';
import { listSnapshotsForWarehouse } from '@/server/repositories/snapshot-repository';
import { listInboundCountsByWarehouseAndDate } from '@/server/repositories/inbound-repository';
import { listHolidays } from '@/server/repositories/holiday-repository';
import { listSchedules } from '@/server/repositories/schedule-repository';
import { UploadCalendar } from '@/components/upload/upload-calendar';
import { dateOnlyToString } from '@/lib/date';
import { requireTenant } from '@/server/tenant';
import { listUploadFileInfo } from '@/server/repositories/upload-file-repository';
import { ViewerNotice } from '@/components/auth/viewer-notice';
import { getMessages } from '@/server/i18n';
import { getSegmentSettings } from '@/server/repositories/settings-repository';
import { getSegmentContext } from '@/server/segments';
import { listDailySales, listRecentOrders } from '@/server/repositories/store-repository';
import { getStoreItemLearning } from '@/server/services/store-service';
import { MANUAL_COUNT_SOURCE } from '@/server/repositories/count-repository';
import { isDateString, todayKstDateString } from '@/lib/date';
import { isSegment } from '@/lib/segments';
import { getPeriodicRows } from '@/server/services/periodic-service';
import { missingSalesDates } from '@/domain/segments/calendar-todo';
import { isPeriodUploadSource } from '@/domain/excel/period-plan';
import type { CalendarTodo } from '@/components/upload/upload-calendar';

/** 공용 캘린더 — 날짜를 누르면 켜 둔 방식별 업로드·입력 패널이 뜬다. ?date=&mode=로 특정 날짜 패널을 바로 연다. */
export default async function UploadPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tenant = await requireTenant();
  const params = await searchParams;
  const { enabled: enabledSegments, active: activeSegment } = await getSegmentContext(tenant.orgId);
  const today = todayKstDateString();
  const usesStore = enabledSegments.includes('ORDER_CYCLE');
  const [sales, orders, storeItems] = usesStore
    ? await Promise.all([listDailySales(tenant.orgId), listRecentOrders(tenant.orgId, 5000), getStoreItemLearning(tenant.orgId, today)])
    : [[], [], []];
  const initialDate = typeof params.date === 'string' && isDateString(params.date) ? params.date : null;
  const initialMode = isSegment(params.mode) && enabledSegments.includes(params.mode) ? params.mode : null;
  const isAdmin = tenant.isAdmin;
  // 켜 둔 재고 방식마다 창고가 하나는 있어야 그 방식의 업로드·실사 입력을 할 수 있다.
  const defaultWarehouseName = (await getMessages()).domain.defaultWarehouse;
  for (const segment of ['DAILY_SYNC', 'PERIODIC_COUNT'] as const) {
    if (enabledSegments.includes(segment)) await ensureSegmentWarehouse(tenant.orgId, segment, defaultWarehouseName);
  }
  const warehouses = await listWarehouses(tenant.orgId);
  const inboundCounts = await listInboundCountsByWarehouseAndDate(tenant.orgId);
  const holidays = await listHolidays(tenant.orgId);
  const schedules = await listSchedules(tenant.orgId);
  const { allowNonWorkingDayUploads } = await getSegmentSettings(tenant.orgId);

  const calendarEntries = (
    await Promise.all(
      warehouses.map(async (w) => {
        const snapshots = await listSnapshotsForWarehouse(w.id);
        const files = await listUploadFileInfo(snapshots.map((s) => s.id));
        return snapshots.map((s) => {
          const date = dateOnlyToString(s.snapshotDate);
          return {
            warehouseId: w.id,
            warehouseCode: w.code,
            warehouseName: w.name,
            date,
            rowCount: s.rowCount,
            uploadedByName: s.uploadedBy.name,
            uploadedAt: s.uploadedAt.toISOString(),
            inboundCount: inboundCounts.get(`${w.id}|${date}`) ?? 0,
            snapshotId: s.id,
            sourceFile: files.get(s.id) ?? null,
            isManual: s.sourceFileName === MANUAL_COUNT_SOURCE,
            isPeriodUpload: isPeriodUploadSource(s.sourceFileName),
          };
        });
      }),
    )
  ).flat();

  // 캘린더 위 할 일 — 켜 둔 방식마다 밀린 것 하나씩. 누르면 그 날짜·방식의 패널이 열린다.
  const todos: CalendarTodo[] = [];
  if (enabledSegments.includes('DAILY_SYNC')) {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const todayClosed = weekday === 0 || weekday === 6 || holidays.some((h) => h.date === today);
    const missing = warehouses.filter((w) => w.segment === 'DAILY_SYNC').filter((w) => !calendarEntries.some((e) => e.warehouseId === w.id && e.date === today)).length;
    if ((!todayClosed || allowNonWorkingDayUploads) && missing > 0) todos.push({ kind: 'dailyMissing', count: missing, date: today, mode: 'DAILY_SYNC' });
  }
  if (enabledSegments.includes('PERIODIC_COUNT')) {
    const { rows } = await getPeriodicRows(tenant.orgId, today);
    const recount = rows.filter((r) => r.estimate.recountReasons.length > 0).length;
    if (recount > 0) todos.push({ kind: 'periodicRecount', count: recount, date: today, mode: 'PERIODIC_COUNT' });
  }
  if (usesStore) {
    const firstActivity = [sales[0]?.date, ...orders.map((o) => o.date)].filter((d): d is string => !!d).sort()[0] ?? null;
    const missing = missingSalesDates(new Set(sales.map((s) => s.date)), firstActivity, today);
    if (missing.length > 0) todos.push({ kind: 'storeMissing', count: missing.length, date: missing[0], mode: 'ORDER_CYCLE' });
  }

  return (
    <div className="space-y-6">
      {tenant.role === 'VIEWER' && <ViewerNotice message={(await getMessages()).account.viewerNotice} />}
      <UploadCalendar
        warehouses={warehouses.map((w) => ({
          id: w.id,
          code: w.code,
          name: w.name,
          segment: w.segment === 'PERIODIC_COUNT' ? ('PERIODIC_COUNT' as const) : ('DAILY_SYNC' as const),
        }))}
        entries={calendarEntries}
        holidays={holidays}
        schedules={schedules}
        isAdmin={isAdmin}
        allowNonWorkingDayUploads={allowNonWorkingDayUploads}
        enabledSegments={enabledSegments}
        activeSegment={activeSegment}
        canEdit={tenant.role !== 'VIEWER'}
        sales={sales}
        orders={orders}
        storeItems={storeItems}
        initialDate={initialDate}
        initialMode={initialMode}
        todos={todos}
      />
    </div>
  );
}
