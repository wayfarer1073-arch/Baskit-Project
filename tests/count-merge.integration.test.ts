import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase } from './db-fixtures';
import { previewUpload, processUpload } from '../src/server/services/upload-service';
import { loadCountSheet, recordCounts } from '../src/server/repositories/count-repository';

requireTestDatabase();
let a: Awaited<ReturnType<typeof createFixture>>;
beforeEach(async () => {
  a = await createFixture();
});
afterEach(async () => {
  await cleanupFixture(a);
});
afterAll(() => prisma.$disconnect());

const excel = (rows: [string, string, number][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['상품코드', '상품명', '정상재고'], ...rows]), 'Stock');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
const upload = (date: string, file: Buffer, replaceExisting = false) =>
  processUpload({
    orgId: a.org.id,
    warehouseId: a.warehouse.id,
    snapshotDate: new Date(`${date}T00:00:00.000Z`),
    fileBuffer: file,
    fileName: `${date}.xlsx`,
    uploadedById: a.user.id,
    replaceExisting,
  });
const manual = (date: string, lines: [string, number][]) =>
  recordCounts(a.org.id, {
    warehouseId: a.warehouse.id,
    date,
    userId: a.user.id,
    lines: lines.map(([code, quantity]) => ({ productCode: code, productName: `${code} 이름`, quantity, unitCost: null, lots: [] })),
  });

it('keeps hand-entered items when Excel replaces the same day, and Excel wins for items in both', async () => {
  expect(
    (
      await upload(
        '2026-09-01',
        excel([
          ['A', '사과', 10],
          ['B', '배', 5],
        ]),
      )
    ).status,
  ).toBe('SUCCESS');
  // 9/02: A·C를 손으로 셌다.
  await manual('2026-09-02', [
    ['A', 8],
    ['C', 3],
  ]);
  // 같은 날 엑셀(A·B)로 교체 — 엑셀에 없는 C(직접 입력)는 남고, A는 엑셀 값이 이긴다.
  expect(
    (
      await upload(
        '2026-09-02',
        excel([
          ['A', '사과', 7],
          ['B', '배', 4],
        ]),
      )
    ).status,
  ).toBe('CONFLICT');
  expect(
    (
      await upload(
        '2026-09-02',
        excel([
          ['A', '사과', 7],
          ['B', '배', 4],
        ]),
        true,
      )
    ).status,
  ).toBe('SUCCESS');

  const sheet = await loadCountSheet(a.org.id, a.warehouse.id, '2026-09-02');
  const day = new Map(sheet!.map((r) => [r.productCode, r.day]));
  expect(day.get('A')).toMatchObject({ quantity: 7, source: 'excel' });
  expect(day.get('B')).toMatchObject({ quantity: 4, source: 'excel' });
  expect(day.get('C')).toMatchObject({ quantity: 3, source: 'manual' });
  // 직접 입력 C는 품절로 처리되지 않는다.
  expect((await prisma.sku.findFirst({ where: { warehouseId: a.warehouse.id, productCode: 'C' } }))?.isActive).toBe(true);
});

it('lists existing SKUs that the Excel file would mark as sold out, only for the latest date', async () => {
  await upload(
    '2026-09-01',
    excel([
      ['A', '사과', 10],
      ['B', '배', 5],
      ['C', '감', 2],
    ]),
  );
  await manual('2026-09-03', [['D', 1]]);

  // 9/03 엑셀에 A만 있으면 B·C가 품절 후보(같은 날 직접 입력한 D는 합쳐 남으므로 제외).
  const preview = await previewUpload(a.org.id, excel([['A', '사과', 9]]), undefined, a.warehouse.id, '2026-09-03');
  if ('error' in preview) throw new Error(preview.error);
  expect(preview.missingSkus.map((s) => s.productCode)).toEqual(['B', 'C']);

  // 더 뒤 날짜의 실사가 있으면 지난 날짜 업로드는 품절 처리를 하지 않으므로 목록이 비어 있다.
  const past = await previewUpload(a.org.id, excel([['A', '사과', 9]]), undefined, a.warehouse.id, '2026-09-02');
  if ('error' in past) throw new Error(past.error);
  expect(past.missingSkus).toEqual([]);
});

it('edits a past date without touching other dates', async () => {
  await upload('2026-09-01', excel([['A', '사과', 10]]));
  await upload('2026-09-05', excel([['A', '사과', 6]]));
  await manual('2026-09-01', [['A', 12]]);

  const first = await loadCountSheet(a.org.id, a.warehouse.id, '2026-09-01');
  expect(first!.find((r) => r.productCode === 'A')).toMatchObject({ day: { quantity: 12, source: 'manual' }, previous: null });
  const later = await loadCountSheet(a.org.id, a.warehouse.id, '2026-09-05');
  expect(later!.find((r) => r.productCode === 'A')).toMatchObject({ day: { quantity: 6, source: 'excel' }, previous: { date: '2026-09-01', quantity: 12 } });
});
