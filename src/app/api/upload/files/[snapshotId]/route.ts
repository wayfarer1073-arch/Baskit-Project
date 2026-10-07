import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { getUploadFile } from '@/server/repositories/upload-file-repository';
import { prisma } from '@/lib/prisma';
import { isPeriodUploadSource } from '@/domain/excel/period-plan';

const PERIOD_NO_ORIGINAL = '일괄 업로드로 저장된 데이터는 원본 파일 생성이 불가능합니다.';

/** 업로드 원본 파일 내려받기(같은 워크스페이스 구성원만). */
export async function GET(_: Request, { params }: { params: Promise<{ snapshotId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { snapshotId } = await params;
  const file = await getUploadFile(tenant.orgId, snapshotId);
  if (!file) {
    // 기간 일괄 업로드로 만든 날은 날짜별 원본이 처음부터 없다 — 그 이유를 알려 준다.
    const snapshot = await prisma.inventorySnapshot.findFirst({ where: { id: snapshotId, warehouse: { organizationId: tenant.orgId } }, select: { sourceFileName: true } });
    const message = snapshot && isPeriodUploadSource(snapshot.sourceFileName) ? PERIOD_NO_ORIGINAL : '보관된 원본 파일이 없습니다.';
    return NextResponse.json({ error: message }, { status: 404 });
  }
  return new Response(new Uint8Array(file.data), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
