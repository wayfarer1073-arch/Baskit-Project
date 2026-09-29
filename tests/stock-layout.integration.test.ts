import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase } from './db-fixtures';
import { processUpload } from '../src/server/services/upload-service';
import { getSkuDetail } from '../src/server/services/inventory-analysis-service';
import { listRegisteredCosts, setSkuUnitCost } from '../src/server/repositories/cost-repository';

requireTestDatabase();
let a: Awaited<ReturnType<typeof createFixture>>;
beforeEach(async () => {
  a = await createFixture();
});
afterEach(async () => {
  await prisma.skuExpirationLot.deleteMany({ where: { sku: { warehouseId: a.warehouse.id } } });
  await cleanupFixture(a);
});
afterAll(() => prisma.$disconnect());

function file(aoa: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'S');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const upload = (date: string, buffer: Buffer) =>
  processUpload({
    orgId: a.org.id,
    warehouseId: a.warehouse.id,
    snapshotDate: new Date(date),
    fileBuffer: buffer,
    fileName: `${date}.xlsx`,
    uploadedById: a.user.id,
    replaceExisting: true,
  });

it('assigns stable A0001 codes by name when the file has no code column, and saves extra columns', async () => {
  const first = await upload(
    '2026-09-21',
    file([
      ['상품명', '정상재고', '소비기한', '상품바코드', 'EA/BOX'],
      ['사과', 10, '2027-01-31', '8800001', 12],
      ['사과', 5, '2027-03-31', '', ''],
      ['배', 3, '', '', ''],
    ]),
  );
  expect(first.status).toBe('SUCCESS');
  const skus = await prisma.sku.findMany({ where: { warehouseId: a.warehouse.id }, orderBy: { productCode: 'asc' } });
  expect(skus.map((s) => [s.productCode, s.currentProductName])).toEqual([
    ['A0001', '사과'],
    ['A0002', '배'],
  ]);
  expect(skus[0]).toMatchObject({ eaPerBox: 12, packagingBarcode: '8800001' });
  const lots = await prisma.skuExpirationLot.findMany({ where: { skuId: skus[0].id }, orderBy: { expirationDate: 'asc' } });
  expect(lots.map((l) => l.expirationDate.toISOString().slice(0, 10))).toEqual(['2027-01-31', '2027-03-31']);

  // 다음 날: 같은 이름은 같은 코드, 새 이름은 다음 번호. 파일에서 빠진 소비기한 로트는 정리된다.
  const second = await upload(
    '2026-09-22',
    file([
      ['상품명', '정상재고', '소비기한'],
      ['배', 2, ''],
      ['귤', 7, ''],
      ['사과', 9, '2027-03-31'],
    ]),
  );
  expect(second.status).toBe('SUCCESS');
  const codes = (await prisma.sku.findMany({ where: { warehouseId: a.warehouse.id }, select: { productCode: true, currentProductName: true } })).map(
    (s) => `${s.productCode}:${s.currentProductName}`,
  );
  expect(codes.sort()).toEqual(['A0001:사과', 'A0002:배', 'A0003:귤']);
  const after = await prisma.skuExpirationLot.findMany({ where: { skuId: skus[0].id } });
  expect(after.map((l) => l.expirationDate.toISOString().slice(0, 10))).toEqual(['2027-03-31']);
});

it('lists registered costs and lets an admin set or remove a cost that later uploads inherit', async () => {
  await upload(
    '2026-09-21',
    file([
      ['상품코드', '상품명', '정상재고', '원가'],
      ['C1', '원가 있음', 10, 500],
      ['C2', '원가 없음', 4, ''],
    ]),
  );
  let costs = await listRegisteredCosts(a.org.id);
  expect(costs.map((c) => [c.productCode, c.unitCost, c.source])).toEqual([['C1', 500, 'FILE']]);

  const c2 = await prisma.sku.findFirstOrThrow({ where: { warehouseId: a.warehouse.id, productCode: 'C2' } });
  expect(await setSkuUnitCost(a.org.id, c2.id, 1200)).toBe(true);
  costs = await listRegisteredCosts(a.org.id);
  expect(costs.find((c) => c.productCode === 'C2')).toMatchObject({ unitCost: 1200, source: 'MANUAL' });

  // 다음 파일에 원가가 없으면 직접 정한 원가를 이어받는다.
  await upload(
    '2026-09-22',
    file([
      ['상품코드', '상품명', '정상재고'],
      ['C1', '원가 있음', 9],
      ['C2', '원가 없음', 3],
    ]),
  );
  const detail = await getSkuDetail(a.org.id, c2.id, '2026-09-22');
  expect(detail?.analysis.latest.unitCost).toBe(1200);
  expect(detail?.valueBreakdown.normalStockValue).toBe(3600);

  // 원가를 지우면 목록에서 빠지고 이후 금액은 0원이다.
  const c1 = await prisma.sku.findFirstOrThrow({ where: { warehouseId: a.warehouse.id, productCode: 'C1' } });
  await setSkuUnitCost(a.org.id, c1.id, null);
  expect((await listRegisteredCosts(a.org.id)).map((c) => c.productCode)).toEqual(['C2']);
  expect((await getSkuDetail(a.org.id, c1.id, '2026-09-22'))?.valueBreakdown.normalStockValue).toBe(0);
  // 다른 워크스페이스에서는 바꿀 수 없다.
  expect(await setSkuUnitCost('other-org', c1.id, 1)).toBe(false);
});
