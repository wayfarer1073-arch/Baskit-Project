import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase } from './db-fixtures';
import { processUpload } from '../src/server/services/upload-service';
import { getUploadFile } from '../src/server/repositories/upload-file-repository';
import { resetUploadForDate } from '../src/server/repositories/snapshot-repository';

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

it('keeps the original file for each upload version, only for its own workspace, and deletes it with the data', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['상품코드', '상품명', '정상재고'],
      ['F1', '원본', 3],
    ]),
    'S',
  );
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const result = await processUpload({
    orgId: a.org.id,
    warehouseId: a.warehouse.id,
    snapshotDate: new Date('2026-09-28'),
    fileBuffer: buffer,
    fileName: '재고 9월 28일.xlsx',
    uploadedById: a.user.id,
    replaceExisting: false,
  });
  if (result.status !== 'SUCCESS') throw new Error(result.status);

  const file = await getUploadFile(a.org.id, result.snapshotId);
  expect(file?.fileName).toBe('재고 9월 28일.xlsx');
  expect(Buffer.from(file!.data).equals(buffer)).toBe(true);
  expect(await getUploadFile(b.org.id, result.snapshotId)).toBeNull();

  await resetUploadForDate(a.warehouse.id, new Date('2026-09-28'));
  expect(await prisma.uploadFile.count({ where: { snapshotId: result.snapshotId } })).toBe(0);
});
