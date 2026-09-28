import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPlatformAdmin } from '@/server/tenant';
import { createDemoWorkspace } from '@/server/demo/demo-workspace';
import { recordAudit } from '@/server/repositories/platform-repository';

const schema = z.object({ segment: z.enum(['DAILY_SYNC', 'PERIODIC_COUNT', 'ORDER_CYCLE']) });

/** 운영자 콘솔: 선택한 관리 방식의 샘플 데이터가 담긴 데모 워크스페이스를 만든다. */
export async function POST(request: Request) {
  const admin = await getPlatformAdmin();
  if (!admin) return NextResponse.json({ error: '운영자만 사용할 수 있습니다.' }, { status: 403 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '관리 방식을 선택하세요.' }, { status: 400 });

  const org = await createDemoWorkspace(parsed.data.segment, admin.userId);
  await recordAudit(admin.userId, 'demo.create', org, { segment: parsed.data.segment });
  return NextResponse.json({ workspace: { id: org.id, name: org.name } }, { status: 201 });
}
