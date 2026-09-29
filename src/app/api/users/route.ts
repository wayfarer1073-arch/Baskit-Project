import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { createUser, listUsers } from '@/server/repositories/user-repository';

const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(50),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.'),
  role: z.enum(['VIEWER', 'MEMBER', 'ADMIN']),
});

export async function GET() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 조회할 수 있습니다.' }, { status: 403 });

  const users = await listUsers(tenant.orgId);
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 사용자를 추가할 수 있습니다.' }, { status: 403 });

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  }

  try {
    const user = await createUser(tenant.orgId, parsed.data);
    return NextResponse.json({ user }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '이미 존재하는 이메일입니다.' }, { status: 409 });
  }
}
