import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { getUploadFile } from '@/server/repositories/upload-file-repository';

/** 업로드 원본 파일 내려받기(같은 워크스페이스 구성원만). */
export async function GET(_: Request, { params }: { params: Promise<{ snapshotId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { snapshotId } = await params;
  const file = await getUploadFile(tenant.orgId, snapshotId);
  if (!file) return NextResponse.json({ error: '보관된 원본 파일이 없습니다.' }, { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
