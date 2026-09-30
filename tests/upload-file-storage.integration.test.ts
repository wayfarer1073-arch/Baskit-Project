import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { cleanupFixture, createFixture, requireTestDatabase, row } from './db-fixtures';
import { createSnapshot, resetUploadForDate } from '../src/server/repositories/snapshot-repository';
import { getUploadFile, storeUploadFile } from '../src/server/repositories/upload-file-repository';
import { createS3FileStore, setFileStoreForTests } from '../src/server/storage/file-store';

requireTestDatabase();

// S3 경로 방식(PUT/GET/DELETE /버킷/키)만 흉내 내는 작은 서버 — 실제 SDK 요청이 오가는지 확인한다.
const objects = new Map<string, Buffer>();
let server: Server;

beforeAll(async () => {
  server = createServer((req, res) => {
    const key = decodeURIComponent((req.url ?? '').split('?')[0]);
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        objects.set(key, Buffer.concat(chunks));
        res.writeHead(200, { ETag: '"x"' }).end();
      });
      return;
    }
    if (req.method === 'GET') {
      const body = objects.get(key);
      if (!body) {
        res.writeHead(404, { 'Content-Type': 'application/xml' }).end('<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>missing</Message></Error>');
        return;
      }
      res.writeHead(200, { 'Content-Length': String(body.length), 'Content-Type': 'application/octet-stream' }).end(body);
      return;
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204).end();
      return;
    }
    res.writeHead(405).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  setFileStoreForTests(
    createS3FileStore({ bucket: 'test-bucket', endpoint: `http://127.0.0.1:${port}`, region: 'auto', accessKeyId: 'test', secretAccessKey: 'test', forcePathStyle: true }),
  );
});
afterAll(async () => {
  setFileStoreForTests(undefined);
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});

let f: Awaited<ReturnType<typeof createFixture>>;
beforeEach(async () => {
  f = await createFixture();
  objects.clear();
});
afterEach(() => cleanupFixture(f));

const date = new Date('2026-09-01T00:00:00.000Z');

it('keeps the original file in object storage and only its key in the database', async () => {
  const snapshot = await createSnapshot({ warehouseId: f.warehouse.id, snapshotDate: date, sourceFileName: 'a.xlsx', fileHash: 'h', uploadedById: f.user.id, rows: [row('A')] });
  const content = Buffer.from('원본 엑셀 내용');
  await storeUploadFile({ snapshotId: snapshot.id, fileName: 'a.xlsx', buffer: content });

  const stored = await prisma.uploadFile.findUniqueOrThrow({ where: { snapshotId: snapshot.id } });
  expect(stored.data).toBeNull();
  expect(stored.storageKey).toMatch(new RegExp(`^uploads/${f.org.id}/${snapshot.id}/`));
  expect(objects.get(`/test-bucket/${stored.storageKey}`)?.toString()).toBe('원본 엑셀 내용');

  const file = await getUploadFile(f.org.id, snapshot.id);
  expect(file?.data.toString()).toBe('원본 엑셀 내용');
  expect(await getUploadFile('other-org', snapshot.id)).toBeNull();

  // 업로드 자료를 지우면 저장소의 파일도 지워진다.
  await resetUploadForDate(f.warehouse.id, date);
  expect(objects.size).toBe(0);
});
