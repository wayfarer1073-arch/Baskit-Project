import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTenant } from '@/server/tenant';
import { createPost, listPosts } from '@/server/repositories/post-repository';
import type { PostTag } from '@prisma/client';

const PAGE_SIZE = 5;
const VALID_TAGS: PostTag[] = ['ISSUE', 'NOTICE', 'CHAT', 'RESOLVED'];

const createPostSchema = z.object({
  tag: z.enum(['ISSUE', 'NOTICE', 'CHAT', 'RESOLVED']),
  title: z.string().trim().min(1, '제목을 입력하세요.').max(50, '제목은 50자 이내로 작성하세요.'),
  body: z.string().trim().min(1, '내용을 입력하세요.').max(200, '본문은 200자 이내로 작성하세요.'),
});

function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateStr;
}

export async function GET(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const keyword = url.searchParams.get('q') ?? undefined;
  const tagsParam = url.searchParams.get('tags');
  const tags = tagsParam
    ? tagsParam
        .split(',')
        .map((t) => t.trim())
        .filter((t): t is PostTag => VALID_TAGS.includes(t as PostTag))
    : undefined;
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const fromDate = fromParam && isValidCalendarDate(fromParam) ? fromParam : undefined;
  const toDate = toParam && isValidCalendarDate(toParam) ? toParam : undefined;

  const { posts, totalCount } = await listPosts(tenant.orgId, page, PAGE_SIZE, { keyword, tags, fromDate, toDate });
  return NextResponse.json({
    posts,
    page,
    pageSize: PAGE_SIZE,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
  });
}

export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const body = await request.json();
  const parsed = createPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  }

  const post = await createPost(tenant.orgId, { ...parsed.data, authorId: tenant.userId });
  return NextResponse.json({ post }, { status: 201 });
}
