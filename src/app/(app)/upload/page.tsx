import { listWarehouses } from '@/server/repositories/warehouse-repository';
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

export default async function UploadPage() {
  const tenant = await requireTenant();
  const isAdmin = tenant.isAdmin;
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
          };
        });
      }),
    )
  ).flat();

  return (
    <div className="space-y-6">
      {tenant.role === 'VIEWER' && <ViewerNotice message={(await getMessages()).account.viewerNotice} />}
      <UploadCalendar
        warehouses={warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
        entries={calendarEntries}
        holidays={holidays.map((h) => ({ date: h.date, name: h.name }))}
        schedules={schedules}
        isAdmin={isAdmin}
        allowNonWorkingDayUploads={allowNonWorkingDayUploads}
      />
    </div>
  );
}
