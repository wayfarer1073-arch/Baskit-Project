import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { getUploadJob } from '@/server/services/upload-job-service';

/** 뒤에서 처리 중인 업로드의 상태. 끝났으면 result에 일반 업로드와 같은 모양의 결과가 들어 있다. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { id } = await params;
  const job = await getUploadJob(tenant.orgId, id);
  if (!job) return NextResponse.json({ error: '작업을 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ id: job.id, status: job.status, result: job.result, error: job.error });
}
