import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { templateDownloadResponse } from '@/server/services/template-download';

export async function GET() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  return templateDownloadResponse('packaging');
}
