import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getFileStore } from '@/server/storage/file-store';

const CONTENT_TYPES: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
};

export function contentTypeFor(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * 업로드 버전(스냅샷)의 원본 파일을 보관한다. 같은 스냅샷에 다시 저장하면 덮어쓴다.
 * 객체 저장소가 설정돼 있으면 내용은 저장소에 두고 DB에는 목록 정보와 키만 남긴다.
 */
export async function storeUploadFile(input: { snapshotId: string; fileName: string; buffer: Buffer }) {
  const snapshot = await prisma.inventorySnapshot.findUnique({ where: { id: input.snapshotId }, select: { warehouse: { select: { organizationId: true } } } });
  if (!snapshot) return null;
  const organizationId = snapshot.warehouse.organizationId;
  const sha256 = createHash('sha256').update(input.buffer).digest('hex');
  const contentType = contentTypeFor(input.fileName);
  const store = getFileStore();
  const storageKey = store ? `uploads/${organizationId}/${input.snapshotId}/${sha256}` : null;
  if (store && storageKey) await store.put(storageKey, input.buffer, contentType);

  const previous = await prisma.uploadFile.findUnique({ where: { snapshotId: input.snapshotId }, select: { storageKey: true } });
  const data = {
    organizationId,
    fileName: input.fileName,
    contentType,
    size: input.buffer.length,
    sha256,
    storageKey,
    data: storageKey ? null : new Uint8Array(input.buffer),
  };
  const saved = await prisma.uploadFile.upsert({ where: { snapshotId: input.snapshotId }, create: { snapshotId: input.snapshotId, ...data }, update: data, select: { id: true } });
  if (previous?.storageKey && previous.storageKey !== storageKey) await removeStoredFiles([previous.storageKey]);
  return saved;
}

/** 이 조직의 스냅샷 원본 파일(내용 포함). 다른 조직 것이거나 내용을 찾을 수 없으면 null. */
export async function getUploadFile(orgId: string, snapshotId: string) {
  const row = await prisma.uploadFile.findFirst({
    where: { snapshotId, organizationId: orgId },
    select: { fileName: true, contentType: true, size: true, data: true, storageKey: true },
  });
  if (!row) return null;
  const content = row.storageKey ? await getFileStore()?.get(row.storageKey) : row.data ? Buffer.from(row.data) : null;
  if (!content) return null;
  return { fileName: row.fileName, contentType: row.contentType, size: row.size, data: content };
}

/** 저장소에 둔 파일 하나를 지운다. 저장소를 쓰지 않거나 이미 없으면 true, 저장소 오류면 false. */
export async function removeStoredFile(key: string): Promise<boolean> {
  const store = getFileStore();
  if (!store) return true;
  try {
    await store.remove(key);
    return true;
  } catch (e) {
    console.error('[file-store] 파일을 지우지 못했습니다', key, e);
    return false;
  }
}

/** 저장소에 둔 파일들을 지운다. 실패해도 다른 작업을 막지 않는다. 지운 개수를 돌려준다. */
export async function removeStoredFiles(keys: (string | null)[]): Promise<number> {
  if (!getFileStore()) return 0;
  let removed = 0;
  for (const key of keys) if (key && (await removeStoredFile(key))) removed++;
  return removed;
}

/** 지우기 전에 저장소 키를 모아 둔다 — DB 행은 스냅샷·워크스페이스와 함께 cascade로 지워지므로. */
export async function storageKeysFor(where: Prisma.UploadFileWhereInput, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<string[]> {
  const rows = await db.uploadFile.findMany({ where: { ...where, storageKey: { not: null } }, select: { storageKey: true } });
  return rows.map((r) => r.storageKey!);
}

/** 스냅샷별 보관 파일 정보(내용 제외) — 화면 목록용. */
export async function listUploadFileInfo(snapshotIds: string[]) {
  if (snapshotIds.length === 0) return new Map<string, { fileName: string; size: number }>();
  const rows = await prisma.uploadFile.findMany({ where: { snapshotId: { in: snapshotIds } }, select: { snapshotId: true, fileName: true, size: true } });
  return new Map(rows.map((r) => [r.snapshotId, { fileName: r.fileName, size: r.size }]));
}
