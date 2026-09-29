import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase } from './db-fixtures';
import { createUploadJob, getUploadJob, runUploadJob } from '../src/server/services/upload-job-service';

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

function file(rows: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['상품코드', '상품명', '정상재고'], ...rows]), 'S');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function run(buffer: Buffer) {
  const snapshotDate = new Date('2026-09-28');
  const job = await createUploadJob({ orgId: a.org.id, userId: a.user.id, warehouseId: a.warehouse.id, snapshotDate, fileName: 'big.xlsx', fileSize: buffer.length });
  expect((await getUploadJob(a.org.id, job.id))?.status).toBe('QUEUED');
  await runUploadJob(job.id, {
    orgId: a.org.id,
    warehouseId: a.warehouse.id,
    snapshotDate,
    fileBuffer: buffer,
    fileName: 'big.xlsx',
    uploadedById: a.user.id,
    replaceExisting: false,
  });
  return job.id;
}

it('processes an upload in the background and stores the result', async () => {
  const id = await run(file([['J1', '큰 파일 품목', 7]]));
  const job = await getUploadJob(a.org.id, id);
  expect(job?.status).toBe('SUCCEEDED');
  expect(job?.result).toMatchObject({ status: 'SUCCESS', rowCount: 1 });
  // 다른 워크스페이스에서는 보이지 않는다.
  expect(await getUploadJob(b.org.id, id)).toBeNull();
});

it('keeps validation errors as a finished job result', async () => {
  const id = await run(Buffer.from('not a spreadsheet'));
  const job = await getUploadJob(a.org.id, id);
  expect(job?.status).toBe('SUCCEEDED');
  expect((job?.result as { status: string }).status).toBe('ERROR');
});

it('marks jobs that never finished as failed', async () => {
  const job = await createUploadJob({ orgId: a.org.id, userId: a.user.id, warehouseId: a.warehouse.id, snapshotDate: new Date('2026-09-28'), fileName: 'x.xlsx', fileSize: 1 });
  await prisma.uploadJob.update({ where: { id: job.id }, data: { status: 'RUNNING', createdAt: new Date(Date.now() - 20 * 60_000) } });
  expect((await getUploadJob(a.org.id, job.id))?.status).toBe('FAILED');
});
