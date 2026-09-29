import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase } from './db-fixtures';
import { previewUpload, processUpload } from '../src/server/services/upload-service';
import { listImportTemplates } from '../src/server/repositories/import-template-repository';

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

function workbook(aoa: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Stock');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// 이 업체 양식: 제목 줄 2개 아래 헤더, 로케이션별로 나뉜 행, 알아보기 어려운 재고 열 이름.
const providerFile = (rows: (string | number)[][]) => workbook([['OO물류 재고현황'], ['출력일 2026-09-18'], ['로케이션', '관리번호', '품명', '현재고수량(EA)'], ...rows]);

it('saves a confirmed layout as a template and applies it to the next file even when columns move', async () => {
  const first = providerFile([
    ['A-01', 'P1', '사과', 3],
    ['A-02', 'P1', '사과', 2],
    ['B-01', 'P2', '배', 4],
  ]);
  const preview = await previewUpload(a.org.id, first);
  if ('error' in preview) throw new Error(preview.error);
  expect(preview.template).toBeNull();
  expect(preview.layout.headerRowIndex).toBe(2);
  // '관리번호'는 상품코드 별칭이 아니라 사용자가 직접 지정한다.
  const layout = { ...preview.layout, columns: { ...preview.layout.columns, productCode: '관리번호', productName: '품명', normalStock: '현재고수량(EA)' } };
  const confirmed = await previewUpload(a.org.id, first, layout);
  if ('error' in confirmed) throw new Error(confirmed.error);
  expect(confirmed.sample.map((r) => [r.productCode, r.normalStock])).toEqual([
    ['P1', 5],
    ['P2', 4],
  ]);

  const saved = await processUpload({
    orgId: a.org.id,
    layout,
    saveTemplateAs: 'OO물류',
    warehouseId: a.warehouse.id,
    snapshotDate: new Date('2026-09-18'),
    fileBuffer: first,
    fileName: 'a.xlsx',
    uploadedById: a.user.id,
    replaceExisting: false,
  });
  expect(saved.status).toBe('SUCCESS');
  expect((await listImportTemplates(a.org.id)).map((t) => t.name)).toEqual(['OO물류']);

  // 다음 날 파일은 열 순서가 바뀌었지만 같은 양식 — 템플릿이 자동 적용된다.
  const next = workbook([['OO물류 재고현황'], ['출력일 2026-09-21'], ['품명', '현재고수량(EA)', '관리번호', '로케이션'], ['사과', 4, 'P1', 'A-01'], ['배', 1, 'P2', 'B-01']]);
  const matched = await previewUpload(a.org.id, next);
  if ('error' in matched) throw new Error(matched.error);
  expect(matched.template?.name).toBe('OO물류');
  const result = await processUpload({
    orgId: a.org.id,
    warehouseId: a.warehouse.id,
    snapshotDate: new Date('2026-09-21'),
    fileBuffer: next,
    fileName: 'b.xlsx',
    uploadedById: a.user.id,
    replaceExisting: false,
  });
  expect(result.status).toBe('SUCCESS');
  const stock = await prisma.inventoryItem.findMany({
    where: { snapshot: { warehouseId: a.warehouse.id, snapshotDate: new Date('2026-09-21') } },
    select: { productCode: true, normalStock: true },
    orderBy: { productCode: 'asc' },
  });
  expect(stock).toEqual([
    { productCode: 'P1', normalStock: 4 },
    { productCode: 'P2', normalStock: 1 },
  ]);

  // 다른 워크스페이스에는 이 템플릿이 적용되지 않는다.
  const other = await previewUpload(b.org.id, next);
  if ('error' in other) throw new Error(other.error);
  expect(other.template).toBeNull();
});
