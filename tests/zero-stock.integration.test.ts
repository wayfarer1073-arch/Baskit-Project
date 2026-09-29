import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase } from './db-fixtures';
import { processUpload } from '../src/server/services/upload-service';
import { getInventoryRows, getSkuDetail } from '../src/server/services/inventory-analysis-service';
import type { ImportLayout } from '../src/domain/excel/layout-types';

requireTestDatabase();
let a: Awaited<ReturnType<typeof createFixture>>;
beforeEach(async () => {
  a = await createFixture();
});
afterEach(async () => {
  await cleanupFixture(a);
});
afterAll(() => prisma.$disconnect());

const layout = (zeroStockAsSoldOut: boolean): ImportLayout => ({
  sheetName: null,
  headerRowIndex: 0,
  columns: { productCode: '상품코드', productName: '상품명', normalStock: '정상재고' },
  duplicateMode: 'sum',
  zeroStockAsSoldOut,
});

async function upload(date: string, rows: [string, number][], zeroStockAsSoldOut = true) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['상품코드', '상품명', '정상재고'], ...rows.map(([code, qty]) => [code, `상품 ${code}`, qty])]), 'S');
  const result = await processUpload({
    orgId: a.org.id,
    layout: layout(zeroStockAsSoldOut),
    warehouseId: a.warehouse.id,
    snapshotDate: new Date(date),
    fileBuffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
    fileName: `${date}.xlsx`,
    uploadedById: a.user.id,
    replaceExisting: true,
  });
  expect(result.status).toBe('SUCCESS');
}

const view = async (asOf: string) => {
  const rows = await getInventoryRows({ orgId: a.org.id, asOfDate: asOf });
  return Object.fromEntries(rows.map((r) => [r.descriptor.productCode, r.descriptor.isSoldOut ? `soldOut:${r.descriptor.soldOutDetectedDate}` : 'active']));
};
const skuId = (code: string) => prisma.sku.findFirstOrThrow({ where: { warehouseId: a.warehouse.id, productCode: code } }).then((s) => s.id);

it('yes: a zero-stock item is sold out for one month from its first zero day, and shows normally on earlier dates', async () => {
  await upload('2026-08-03', [
    ['Z1', 10],
    ['K', 5],
  ]);
  await upload('2026-08-04', [
    ['Z1', 0],
    ['K', 5],
  ]);
  await upload('2026-08-05', [
    ['Z1', 0],
    ['K', 4],
  ]);
  expect(await view('2026-08-05')).toEqual({ Z1: 'soldOut:2026-08-04', K: 'active' });
  expect(await view('2026-08-03')).toEqual({ Z1: 'active', K: 'active' });

  const detail = await getSkuDetail(a.org.id, await skuId('Z1'), '2026-08-05');
  expect(detail?.descriptor.isSoldOut).toBe(true);
  expect(detail?.observations.map((o) => o.normalStock)).toEqual([10, 0, 0]);

  // 재고 0이 시작된 날부터 1개월이 지나면 품절 목록에서도 빠진다.
  await upload('2026-09-04', [
    ['Z1', 0],
    ['K', 3],
  ]);
  expect(await view('2026-09-04')).toEqual({ K: 'active' });
  expect(await getSkuDetail(a.org.id, await skuId('Z1'), '2026-09-04')).toBeNull();
  expect(await view('2026-08-20')).toEqual({ Z1: 'soldOut:2026-08-04', K: 'active' });

  // 다시 재고가 생기면 관리 목록으로 돌아온다.
  await upload('2026-09-07', [
    ['Z1', 7],
    ['K', 3],
  ]);
  expect(await view('2026-09-07')).toEqual({ Z1: 'active', K: 'active' });
  expect((await prisma.sku.findUniqueOrThrow({ where: { id: await skuId('Z1') } })).soldOutDetectedDate).toBeNull();
});

it('no: a zero-stock item leaves management right away, with no sold-out window, but earlier dates still show it', async () => {
  await upload(
    '2026-08-03',
    [
      ['R1', 10],
      ['K', 5],
    ],
    false,
  );
  await upload(
    '2026-08-04',
    [
      ['R1', 0],
      ['K', 5],
    ],
    false,
  );
  expect(await view('2026-08-04')).toEqual({ K: 'active' });
  expect(await getSkuDetail(a.org.id, await skuId('R1'), '2026-08-04')).toBeNull();
  expect(await view('2026-08-03')).toEqual({ R1: 'active', K: 'active' });
  const removed = await prisma.sku.findUniqueOrThrow({ where: { id: await skuId('R1') } });
  expect(removed.removedDate?.toISOString().slice(0, 10)).toBe('2026-08-04');
  expect(removed.soldOutDetectedDate).toBeNull();

  // 이후 파일에서 아예 빠져도 품절이 아니라 계속 제외 상태다.
  await upload('2026-08-05', [['K', 4]], false);
  expect(await view('2026-08-05')).toEqual({ K: 'active' });
  expect((await prisma.sku.findUniqueOrThrow({ where: { id: removed.id } })).soldOutDetectedDate).toBeNull();
});

it('saves the zero-stock choice and stock unit with the layout template', async () => {
  const { saveImportTemplate, listImportTemplates } = await import('../src/server/repositories/import-template-repository');
  await saveImportTemplate(a.org.id, '제외 양식', 'fp-test', { ...layout(false), stockUnit: 'BOX' });
  const [saved] = await listImportTemplates(a.org.id);
  expect(saved.layout).toMatchObject({ zeroStockAsSoldOut: false, stockUnit: 'BOX' });
});
