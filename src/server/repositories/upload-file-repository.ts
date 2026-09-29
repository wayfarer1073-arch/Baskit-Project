import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';

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

/** 업로드 버전(스냅샷)의 원본 파일을 보관한다. 같은 스냅샷에 다시 저장하면 덮어쓴다. */
export async function storeUploadFile(input: { snapshotId: string; fileName: string; buffer: Buffer }) {
  const snapshot = await prisma.inventorySnapshot.findUnique({ where: { id: input.snapshotId }, select: { warehouse: { select: { organizationId: true } } } });
  if (!snapshot) return null;
  const data = {
    organizationId: snapshot.warehouse.organizationId,
    fileName: input.fileName,
    contentType: contentTypeFor(input.fileName),
    size: input.buffer.length,
    sha256: createHash('sha256').update(input.buffer).digest('hex'),
    data: new Uint8Array(input.buffer),
  };
  return prisma.uploadFile.upsert({ where: { snapshotId: input.snapshotId }, create: { snapshotId: input.snapshotId, ...data }, update: data, select: { id: true } });
}

/** 이 조직의 스냅샷 원본 파일. 다른 조직 것이면 null. */
export function getUploadFile(orgId: string, snapshotId: string) {
  return prisma.uploadFile.findFirst({ where: { snapshotId, organizationId: orgId }, select: { fileName: true, contentType: true, size: true, data: true } });
}

/** 스냅샷별 보관 파일 정보(내용 제외) — 화면 목록용. */
export async function listUploadFileInfo(snapshotIds: string[]) {
  if (snapshotIds.length === 0) return new Map<string, { fileName: string; size: number }>();
  const rows = await prisma.uploadFile.findMany({ where: { snapshotId: { in: snapshotIds } }, select: { snapshotId: true, fileName: true, size: true } });
  return new Map(rows.map((r) => [r.snapshotId, { fileName: r.fileName, size: r.size }]));
}
