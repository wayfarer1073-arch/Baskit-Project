import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, row } from './db-fixtures';
import { createSnapshot } from '../src/server/repositories/snapshot-repository';
import { previewPeriodUpload, runPeriodUpload, type PeriodUploadInput } from '../src/server/services/period-upload-service';
import { isPeriodUploadSource } from '../src/domain/excel/period-plan';

let f: Awaited<ReturnType<typeof createFixture>>;
beforeEach(async () => {
  f = await createFixture();
});
afterEach(() => cleanupFixture(f));
afterAll(() => prisma.$disconnect());

const header = ['공급처', '상품코드', '상품명', '09-29', '09-30', '10-01', '10-02'];
const stockAoa = (v001 = '8') => [
  header,
  ['A상사', '001', '젤리 70g', '10', v001, '', '5'],
  ['A상사', '002', '꿀 500g', '', '', '20', '18'],
  ['A상사', '003', '쿠키', '', '', '', ''],
  ['A상사', '004', '캔디', '', '', '', ''],
  ['A상사', '005', '시럽', '', '', '', '3'],
];
const inboundAoa = [header, ['A상사', '002', '꿀 500g', '', '', '24', ''], ['A상사', '005', '시럽', '', '6', '', ''], ['A상사', '999', '모르는 상품', '3', '', '', '']];

const input = (overrides: Partial<PeriodUploadInput> = {}): PeriodUploadInput => ({
  orgId: f.org.id,
  warehouseId: f.warehouse.id,
  userId: f.user.id,
  // 파일 이름의 날짜(20261007)를 기준으로 07-01 같은 날짜 열의 연도를 정한다.
  stock: { aoa: stockAoa(), fileName: '일자별재고현황_20261007.xlsx' },
  inbound: { aoa: inboundAoa, fileName: '입고현황_20261007.xlsx' },
  overwrite: false,
  ...overrides,
});

async function stockOn(date: string) {
  const snap = await prisma.inventorySnapshot.findFirst({
    where: { warehouseId: f.warehouse.id, snapshotDate: new Date(`${date}T00:00:00Z`), status: 'ACTIVE' },
    include: { items: { include: { sku: { select: { productCode: true } } } } },
  });
  return snap ? Object.fromEntries(snap.items.map((i) => [i.sku.productCode, i.normalStock]).sort()) : null;
}

it('fills only the dates not uploaded yet, treats blanks after registration as sold out, and records inbound', async () => {
  // 창고에 이미 있던 SKU 004(09-28부터)와 이미 올린 09-30.
  await createSnapshot({
    warehouseId: f.warehouse.id,
    snapshotDate: new Date('2026-09-28T00:00:00Z'),
    sourceFileName: 'a.xlsx',
    fileHash: 'a',
    uploadedById: f.user.id,
    rows: [row('004', 7)],
  });
  await createSnapshot({
    warehouseId: f.warehouse.id,
    snapshotDate: new Date('2026-09-30T00:00:00Z'),
    sourceFileName: 'b.xlsx',
    fileHash: 'b',
    uploadedById: f.user.id,
    rows: [row('001', 99), row('004', 7)],
  });

  const preview = await previewPeriodUpload(input());
  expect(preview).toMatchObject({
    from: '2026-09-29',
    to: '2026-10-02',
    totalDays: 4,
    uploadDays: 3,
    existingDays: 1,
    registeredCount: 4,
    emptyCount: 1,
    startedByInbound: 1,
    inboundEntries: 2,
    inboundExisting: 0,
    inboundUnknown: ['999'],
  });

  const result = await runPeriodUpload(input());
  expect(result).toMatchObject({ uploadedDays: 3, skippedDays: 0, inboundCreated: 2, inboundSkipped: 0 });
  expect(await stockOn('2026-09-29')).toEqual({ '001': 10, '004': 0 });
  expect(await stockOn('2026-09-30')).toEqual({ '001': 99, '004': 7 }); // 이미 올린 날은 그대로
  // 일괄 업로드로 만든 날은 파일명 머리말로 구분한다(원본 파일 내려받기 대신 안내).
  const sources = await prisma.inventorySnapshot.findMany({
    where: { warehouseId: f.warehouse.id, status: 'ACTIVE' },
    orderBy: { snapshotDate: 'asc' },
    select: { sourceFileName: true },
  });
  expect(sources.map((s) => isPeriodUploadSource(s.sourceFileName))).toEqual([false, true, false, true, true]);
  expect(await prisma.uploadFile.count({ where: { snapshot: { warehouseId: f.warehouse.id } } })).toBe(0);
  expect(await stockOn('2026-10-01')).toEqual({ '001': 0, '002': 20, '004': 0, '005': 0 });
  expect(await stockOn('2026-10-02')).toEqual({ '001': 5, '002': 18, '004': 0, '005': 3 });

  const skus = await prisma.sku.findMany({ where: { warehouseId: f.warehouse.id }, orderBy: { productCode: 'asc' } });
  expect(skus.map((s) => s.productCode)).toEqual(['001', '002', '004', '005']); // 기간 내내 빈 003은 만들지 않는다
  const s004 = skus.find((s) => s.productCode === '004')!;
  expect(s004.isActive).toBe(false);
  expect(s004.soldOutDetectedDate?.toISOString().slice(0, 10)).toBe('2026-10-01'); // 최신이 된 첫 품절일부터 이어진다
  const inbound = await prisma.snapshotInbound.findMany({ where: { sku: { warehouseId: f.warehouse.id } }, orderBy: { productCode: 'asc' } });
  expect(inbound.map((i) => [i.productCode, i.snapshotDate.toISOString().slice(0, 10), i.quantity])).toEqual([
    ['002', '2026-10-01', 24],
    ['005', '2026-09-30', 6],
  ]);

  // 같은 파일을 다시 올리면 채울 것이 없다.
  expect(await previewPeriodUpload(input())).toMatchObject({ uploadDays: 0, existingDays: 4, inboundExisting: 2 });
  expect(await runPeriodUpload(input())).toMatchObject({ uploadedDays: 0, inboundCreated: 0, inboundSkipped: 2 });

  // 덮어쓰기: 09-30도 파일 값으로, 입고 수량도 파일 값으로 바꾼다.
  const changedInbound = [header, ['A상사', '002', '꿀 500g', '', '', '30', '']];
  const replaced = await runPeriodUpload(
    input({ overwrite: true, stock: { aoa: stockAoa('9'), fileName: '재고_20261007.xlsx' }, inbound: { aoa: changedInbound, fileName: '입고.xlsx' } }),
  );
  expect(replaced).toMatchObject({ uploadedDays: 4, inboundUpdated: 1, inboundCreated: 0 });
  // 09-30의 004는 파일에서 빈칸이라 품절로 바뀐다. 002·005는 10-01부터 등록이라 09-30에는 없다.
  expect(await stockOn('2026-09-30')).toEqual({ '001': 9, '004': 0 });
});
