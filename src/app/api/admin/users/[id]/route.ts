import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPlatformAdmin } from '@/server/tenant';
import { getUserForAdmin, recordAudit, setUserActive } from '@/server/repositories/platform-repository';

const schema = z.object({ isActive: z.boolean() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getPlatformAdmin();
  if (!admin) return NextResponse.json({ error: '운영자만 사용할 수 있습니다.' }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });
  const user = await getUserForAdmin(id);
  if (!user) return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
  if (user.isPlatformAdmin) return NextResponse.json({ error: '운영자 계정은 콘솔에서 바꿀 수 없습니다.' }, { status: 400 });

  await setUserActive(id, parsed.data.isActive);
  await recordAudit(admin.userId, parsed.data.isActive ? 'user.activate' : 'user.deactivate', { id: user.organizationId, name: user.organization.name }, { email: user.email });
  return NextResponse.json({ ok: true });
}
