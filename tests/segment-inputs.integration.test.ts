import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase, row } from './db-fixtures';
import { createSnapshot } from '../src/server/repositories/snapshot-repository';
import { loadCountSheet, recordCounts } from '../src/server/repositories/count-repository';
import { getPeriodicRows, getPeriodicSkuDetail } from '../src/server/services/periodic-service';
import { addPurchaseOrders, createStoreItem, createSupplier, upsertDailySales } from '../src/server/repositories/store-repository';
import { getStoreDashboard } from '../src/server/services/store-service';
import { updateSegmentSettings } from '../src/server/repositories/settings-repository';

requireTestDatabase();
let a: Awaited<ReturnType<typeof createFixture>>;
let b: Awaited<ReturnType<typeof createFixture>>;
beforeEach(async () => {
  a = await createFixture();
  b = await createFixture();
});
afterEach(async () => {
  await cleanupFixture(a);
  await cleanupFixture(b);
});
afterAll(() => prisma.$disconnect());

const line = (productCode: string, quantity: number, lots: { lot: string; quantity: number }[] = []) => ({
  productCode,
  productName: `${productCode} 이름`,
  quantity,
  unitCost: null,
  lots,
});

it('merges a hand-entered count into that day and never marks uncounted SKUs as sold out', async () => {
  await createSnapshot({
    warehouseId: a.warehouse.id,
    uploadedById: a.user.id,
    snapshotDate: new Date('2026-09-01'),
    sourceFileName: 'full.xlsx',
    fileHash: 'full',
    rows: [row('A', 100), row('B', 50)],
  });
  // 9/10: A만 직접 셈 (롯트 두 개). B는 세지 않았다.
  await recordCounts(a.org.id, {
    warehouseId: a.warehouse.id,
    date: '2026-09-10',
    userId: a.user.id,
    lines: [
      line('A', 0, [
        { lot: 'L1', quantity: 30 },
        { lot: 'L2', quantity: 40 },
      ]),
    ],
  });
  // 같은 날 새 상품 C를 한 번 더 입력 — 9/10의 A 기록은 그대로 남아야 한다.
  await recordCounts(a.org.id, { warehouseId: a.warehouse.id, date: '2026-09-10', userId: a.user.id, lines: [line('C', 12)] });

  const skus = await prisma.sku.findMany({ where: { warehouseId: a.warehouse.id }, orderBy: { productCode: 'asc' } });
  expect(skus.map((s) => [s.productCode, s.isActive])).toEqual([
    ['A', true],
    ['B', true],
    ['C', true],
  ]);

  const { rows } = await getPeriodicRows(a.org.id, '2026-09-12');
  const byCode = new Map(rows.map((r) => [r.productCode, r.estimate]));
  expect(byCode.get('A')?.lastCountQuantity).toBe(70); // 롯트 합계
  expect(byCode.get('A')?.dailyUsage).toBeCloseTo(30 / 9);
  expect(byCode.get('B')?.lastCountDate).toBe('2026-09-01'); // 세지 않은 상품은 이전 실사 그대로
  expect(byCode.get('C')?.lastCountQuantity).toBe(12);

  const detail = await getPeriodicSkuDetail(a.org.id, skus[0].id, '2026-09-12');
  expect(detail?.counts[0]).toMatchObject({
    date: '2026-09-10',
    quantity: 70,
    manual: true,
    lots: [
      { lot: 'L1', quantity: 30 },
      { lot: 'L2', quantity: 40 },
    ],
  });
  expect(detail?.counts[1]).toMatchObject({ date: '2026-09-01', manual: false });

  const sheet = await loadCountSheet(a.org.id, a.warehouse.id, '2026-09-10');
  expect(sheet?.find((s) => s.productCode === 'A')?.day).toMatchObject({ quantity: 70, source: 'manual' });
  expect(sheet?.find((s) => s.productCode === 'A')?.day?.lots).toHaveLength(2);

  // 다른 조직은 이 창고에 쓰거나 읽을 수 없다.
  expect(await recordCounts(b.org.id, { warehouseId: a.warehouse.id, date: '2026-09-11', userId: b.user.id, lines: [line('A', 1)] })).toBeNull();
  expect(await loadCountSheet(b.org.id, a.warehouse.id, '2026-09-10')).toBeNull();
  expect(await getPeriodicSkuDetail(b.org.id, skus[0].id, '2026-09-12')).toBeNull();
});

it('uses the supplier lead time, the stored leftover and the configured check ratio', async () => {
  const supplier = await createSupplier(a.org.id, { name: '동네 유업', leadTimeDays: 4 });
  const item = await createStoreItem(a.org.id, { name: '우유', unit: '팩', leadTimeDays: 1, supplierId: supplier.id });
  expect(item).not.toBeNull();
  // 다른 조직의 발주처는 연결할 수 없다.
  expect(await createStoreItem(b.org.id, { name: '우유', unit: '팩', leadTimeDays: 1, supplierId: supplier.id })).toBeNull();

  await addPurchaseOrders(a.org.id, { date: '2026-09-01', createdById: a.user.id, lines: [{ itemId: item!.id, quantity: 10, coverageAmount: 1_000_000, leftoverQuantity: null }] });
  await addPurchaseOrders(a.org.id, { date: '2026-09-11', createdById: a.user.id, lines: [{ itemId: item!.id, quantity: 10, coverageAmount: 1_000_000, leftoverQuantity: 2 }] });
  for (let d = 1; d <= 14; d++) await upsertDailySales(a.org.id, `2026-09-${String(d).padStart(2, '0')}`, 100_000);

  await updateSegmentSettings(a.org.id, { storeCheckRemainingPct: 50 });
  const data = await getStoreDashboard(a.org.id, '2026-09-14');
  const r = data.rows[0];
  expect(r.leadTimeDays).toBe(4);
  expect(r.supplierName).toBe('동네 유업');
  expect(data.checkRemainingPct).toBe(50);
  // 첫 회차: 10팩 중 2팩 남음 → 8팩으로 100만 원 → 팩당 12.5만 원.
  expect(r.analysis.salesPerUnit).toBeCloseTo(125_000);
  expect(r.analysis.openingUnits).toBe(12);
  expect(r.analysis.cycles[0]).toMatchObject({ leftoverAtNext: 2, consumedUnits: 8, overrunSales: 0 });
});
