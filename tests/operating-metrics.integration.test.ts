import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { createFixture, cleanupFixture, requireTestDatabase, row } from './db-fixtures';
import { createSnapshot } from '../src/server/repositories/snapshot-repository';
import { getInventoryRows, getSkuDetail } from '../src/server/services/inventory-analysis-service';
import { applyExpirationLotRows } from '../src/server/repositories/expiration-repository';
import { calculateCompanyKpis } from '../src/domain/inventory/aggregation';
import { loadWarehouseCalendars } from '../src/server/repositories/calendar-repository';
import { isShippingDay } from '../src/domain/inventory/shipping-calendar';

requireTestDatabase();
let fixture: Awaited<ReturnType<typeof createFixture>>;
let holidayId: string | undefined;
beforeEach(async () => {
  fixture = await createFixture();
});
afterEach(async () => {
  if (holidayId) {
    await prisma.holiday.delete({ where: { id: holidayId } });
    holidayId = undefined;
  }
  await cleanupFixture(fixture);
});
afterAll(() => prisma.$disconnect());
async function seed(dates = ['04', '07', '08', '09', '10', '11', '14', '15', '16', '17', '18'], stocks?: number[]) {
  for (const [i, day] of dates.entries())
    await createSnapshot({
      warehouseId: fixture.warehouse.id,
      uploadedById: fixture.user.id,
      snapshotDate: new Date(`2026-09-${day}`),
      sourceFileName: 'metrics.xlsx',
      fileHash: day,
      rows: [row('A', stocks?.[i] ?? 200 - i * 10)],
    });
  return prisma.sku.findFirstOrThrow({ where: { warehouseId: fixture.warehouse.id, productCode: 'A' } });
}

it('uses registered non-shipping holidays identically in list and detail services', async () => {
  holidayId = (await prisma.holiday.create({ data: { organizationId: fixture.org.id, date: new Date('2026-09-16'), name: 'Local test holiday' } })).id;
  // 9/16 휴무에 들어온 주문은 9/17에 함께 출고된다(9/15 → 9/17: −20).
  const sku = await seed(['04', '07', '08', '09', '10', '11', '14', '15', '17', '18'], [200, 190, 180, 170, 160, 150, 140, 130, 110, 100]);
  const rows = await getInventoryRows({ orgId: fixture.org.id, warehouseId: fixture.warehouse.id, asOfDate: '2026-09-18' });
  const detail = await getSkuDetail(fixture.org.id, sku.id, '2026-09-18');
  expect(rows[0].analysis).toEqual(detail?.analysis);
  expect(rows[0].analysis.window7.averageDailyDepletion).toBe(10);
  expect(rows[0].analysis.window7.observedIntervalDays).toBe(5);
  expect(rows[0].analysis.coverage.coverageDays).toBe(10);
});

it('keeps B2B cost and earliest lot dates while suppressing repeated-demand predictions', async () => {
  const sku = await seed();
  await prisma.sku.update({ where: { id: sku.id }, data: { isB2B: true } });
  await applyExpirationLotRows(fixture.warehouse.id, [
    { rowNumber: 1, productCode: 'A', productName: 'A', lot: 'earliest', expirationDate: '2026-09-20' },
    { rowNumber: 2, productCode: 'A', productName: 'A', lot: 'later', expirationDate: '2026-12-31' },
  ]);
  const rows = await getInventoryRows({ orgId: fixture.org.id, warehouseId: fixture.warehouse.id, asOfDate: '2026-09-18' });
  expect(rows[0].descriptor.expirationDate).toBe('2026-09-20');
  expect(rows[0].analysis.operating?.reason).toBe('특수 관리 개별 판단');
  expect(rows[0].analysis.coverage.coverageDays).toBeNull();
  expect(rows[0].analysis.expirationRisk.isAtRisk).toBe(true);
  expect(calculateCompanyKpis(rows, 30).snapshot.knownInventoryValue).toBe(1000);
});

it('preserves departed-SKU history but excludes its last balance from current asset totals', async () => {
  await seed();
  await createSnapshot({
    warehouseId: fixture.warehouse.id,
    uploadedById: fixture.user.id,
    snapshotDate: new Date('2026-09-21'),
    sourceFileName: 'metrics.xlsx',
    fileHash: 'departed',
    rows: [row('B', 20)],
  });
  const rows = await getInventoryRows({ orgId: fixture.org.id, warehouseId: fixture.warehouse.id, asOfDate: '2026-09-21' });
  const missing = rows.find((r) => r.descriptor.productCode === 'A')!;
  expect(missing.analysis.operating?.reason).toBe('품절');
  expect(missing.analysis.latest.normalStock).toBe(100);
  expect(missing.analysis.forecast.expectedStockoutDate).toBeNull();
  const kpis = calculateCompanyKpis(rows, 30);
  expect(kpis.snapshot.knownInventoryValue).toBe(200);
  expect(kpis.totalInventoryValue).toBe(200);
});

it('counts a weekend upload as a working day only for the warehouse that uploaded, even after the setting is turned off', async () => {
  const other = await prisma.warehouse.create({ data: { organizationId: fixture.org.id, code: `${fixture.warehouse.code}-2`, name: 'Second' } });
  try {
    await seed(['17', '18', '19']); // 9/19 = 토요일 업로드
    const { calendarFor } = await loadWarehouseCalendars(fixture.org.id);
    expect(isShippingDay('2026-09-19', calendarFor(fixture.warehouse.id))).toBe(true);
    expect(isShippingDay('2026-09-19', calendarFor(other.id))).toBe(false);
    const rows = await getInventoryRows({ orgId: fixture.org.id, warehouseId: fixture.warehouse.id, asOfDate: '2026-09-19' });
    expect(rows[0].analysis.operating?.staleShippingDays).toBe(0);
  } finally {
    await prisma.warehouse.delete({ where: { id: other.id } });
  }
});
