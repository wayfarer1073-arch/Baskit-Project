import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/server/tenant';
import { deletePost, updatePost, PostNotFoundError, PostPermissionError } from '@/server/repositories/post-repository';

const updatePostSchema = z.object({
  tag: z.enum(['ISSUE', 'NOTICE', 'CHAT', 'RESOLVED']),
  title: z.string().trim().min(1, '제목을 입력하세요.').max(50, '제목은 50자 이내로 작성하세요.'),
  body: z.string().trim().min(1, '내용을 입력하세요.').max(200, '본문은 200자 이내로 작성하세요.'),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const parsed = updatePostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  }

  try {
    const post = await updatePost(tenant.orgId, id, { id: tenant.userId, role: tenant.role }, parsed.data);
    return NextResponse.json({ post });
  } catch (error) {
    if (error instanceof PostPermissionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof PostNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { id } = await params;
  try {
    await deletePost(tenant.orgId, id, { id: tenant.userId, role: tenant.role });
  } catch (error) {
    if (error instanceof PostPermissionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof PostNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  return NextResponse.json({ ok: true });
}
