import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase, row } from './db-fixtures';
import { createSnapshot } from '../src/server/repositories/snapshot-repository';
import { DEFAULT_RETENTION, runRetention } from '../src/server/maintenance/retention';

requireTestDatabase();

let f: Awaited<ReturnType<typeof createFixture>>;
beforeEach(async () => {
  f = await createFixture();
});
afterEach(() => cleanupFixture(f));
afterAll(() => prisma.$disconnect());

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function fileFor(date: string, createdAt: Date) {
  const snapshot = await createSnapshot({
    warehouseId: f.warehouse.id,
    snapshotDate: new Date(`${date}T00:00:00.000Z`),
    sourceFileName: `${date}.xlsx`,
    fileHash: date,
    uploadedById: f.user.id,
    rows: [row('A')],
  });
  await prisma.uploadFile.create({
    data: { organizationId: f.org.id, snapshotId: snapshot.id, fileName: `${date}.xlsx`, contentType: 'text/csv', size: 1, sha256: date, data: new Uint8Array([1]), createdAt },
  });
  return snapshot.id;
}

it('removes only by-products past their retention period and keeps inventory data', async () => {
  const oldFile = await fileFor('2026-01-01', daysAgo(DEFAULT_RETENTION.uploadFileDays + 1));
  const newFile = await fileFor('2026-09-01', daysAgo(1));
  const job = (status: 'SUCCEEDED' | 'RUNNING', days: number) =>
    prisma.uploadJob.create({
      data: { organizationId: f.org.id, warehouseId: f.warehouse.id, snapshotDate: new Date('2026-09-01'), fileName: 'x', fileSize: 1, status, createdAt: daysAgo(days) },
    });
  const oldJob = await job('SUCCEEDED', 40);
  const runningJob = await job('RUNNING', 40);
  const token = (days: number) => prisma.authToken.create({ data: { userId: f.user.id, type: 'PASSWORD_RESET', tokenHash: `${f.org.id}-${days}`, expiresAt: daysAgo(days) } });
  const oldToken = await token(10);
  const liveToken = await token(-1);
  const invite = (days: number) =>
    prisma.invitation.create({ data: { organizationId: f.org.id, email: `${days}@test.invalid`, tokenHash: `${f.org.id}-inv-${days}`, expiresAt: daysAgo(days) } });
  const oldInvite = await invite(40);
  const pendingInvite = await invite(-3);

  await runRetention();

  expect(await prisma.uploadFile.findUnique({ where: { snapshotId: oldFile } })).toBeNull();
  expect(await prisma.uploadFile.findUnique({ where: { snapshotId: newFile } })).not.toBeNull();
  // 원본 파일만 지우고 그 업로드의 재고 데이터는 남는다.
  expect(await prisma.inventoryItem.count({ where: { snapshotId: oldFile } })).toBe(1);
  expect(await prisma.uploadJob.findUnique({ where: { id: oldJob.id } })).toBeNull();
  expect(await prisma.uploadJob.findUnique({ where: { id: runningJob.id } })).not.toBeNull();
  expect(await prisma.authToken.findUnique({ where: { id: oldToken.id } })).toBeNull();
  expect(await prisma.authToken.findUnique({ where: { id: liveToken.id } })).not.toBeNull();
  expect(await prisma.invitation.findUnique({ where: { id: oldInvite.id } })).toBeNull();
  expect(await prisma.invitation.findUnique({ where: { id: pendingInvite.id } })).not.toBeNull();
});

it('keeps everything for an item whose retention is set to 0', async () => {
  const oldFile = await fileFor('2026-01-01', daysAgo(1000));
  await runRetention(new Date(), { ...DEFAULT_RETENTION, uploadFileDays: 0 });
  expect(await prisma.uploadFile.findUnique({ where: { snapshotId: oldFile } })).not.toBeNull();
});
