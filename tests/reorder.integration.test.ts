import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase } from './db-fixtures';
import { processUpload } from '../src/server/services/upload-service';
import { getSkuDetail } from '../src/server/services/inventory-analysis-service';
import { updateReorderDefaults, updateSkuReorder } from '../src/server/repositories/reorder-repository';

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

function file(stock: number): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['상품코드', '상품명', '정상재고'],
      ['R1', '물티슈', stock],
    ]),
    'Stock',
  );
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// 2026-09-14(월) ~ 09-25(금) 평일 10일, 하루 10개씩 줄어든다.
const WEEKDAYS = ['14', '15', '16', '17', '18', '21', '22', '23', '24', '25'].map((d) => `2026-09-${d}`);

async function seedSeries(fixture: typeof a) {
  for (const [i, date] of WEEKDAYS.entries()) {
    const result = await processUpload({
      orgId: fixture.org.id,
      warehouseId: fixture.warehouse.id,
      snapshotDate: new Date(date),
      fileBuffer: file(300 - i * 10),
      fileName: `${date}.xlsx`,
      uploadedById: fixture.user.id,
      replaceExisting: false,
    });
    expect(result.status).toBe('SUCCESS');
  }
  return prisma.sku.findFirstOrThrow({ where: { warehouseId: fixture.warehouse.id, productCode: 'R1' } });
}

it('suggests an order with item > supplier > workspace default rules', async () => {
  const sku = await seedSeries(a);
  const asOf = WEEKDAYS.at(-1)!;

  const plain = await getSkuDetail(a.org.id, sku.id, asOf);
  expect(plain?.reorder?.policy.sources).toEqual({ leadTimeDays: 'default', safetyDays: 'default', targetDays: 'default', minOrderQty: 'default', orderMultiple: 'default' });
  expect(plain?.reorder?.status).toBe('later');
  expect(plain?.turnover30?.ratio).toBeGreaterThan(0);

  await updateReorderDefaults(a.org.id, { reorderSafetyDays: 5 });
  const supplier = await prisma.supplier.create({ data: { organizationId: a.org.id, name: '물티슈 공급', leadTimeDays: 7, targetDays: 20 } });
  expect(
    await updateSkuReorder(a.org.id, sku.id, {
      supplierId: supplier.id,
      reorderLeadTimeDays: null,
      reorderSafetyDays: null,
      reorderTargetDays: null,
      reorderMinQty: null,
      reorderMultiple: 24,
    }),
  ).toBe(true);

  const layered = await getSkuDetail(a.org.id, sku.id, asOf);
  const reorder = layered!.reorder!;
  expect(reorder.policy).toMatchObject({ leadTimeDays: 7, safetyDays: 5, targetDays: 20, orderMultiple: 24 });
  expect(reorder.policy.sources).toMatchObject({ leadTimeDays: 'supplier', safetyDays: 'default', targetDays: 'supplier', orderMultiple: 'item' });
  expect(reorder.quantity % 24).toBe(0);
  // 리드타임이 길어져 기본값일 때보다 일찍 발주해야 한다.
  expect(reorder.orderDate! < plain!.reorder!.orderDate!).toBe(true);
});

it("refuses to link another workspace's supplier or item", async () => {
  const sku = await seedSeries(a);
  const foreign = await prisma.supplier.create({ data: { organizationId: b.org.id, name: '남의 거래처', leadTimeDays: 1 } });
  const empty = { reorderLeadTimeDays: null, reorderSafetyDays: null, reorderTargetDays: null, reorderMinQty: null, reorderMultiple: null };
  expect(await updateSkuReorder(a.org.id, sku.id, { supplierId: foreign.id, ...empty })).toBe(false);
  expect(await updateSkuReorder(b.org.id, sku.id, { supplierId: null, ...empty })).toBe(false);
});
