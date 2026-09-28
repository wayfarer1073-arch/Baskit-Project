import { requireTenant } from '@/server/tenant';
import { listPosts } from '@/server/repositories/post-repository';
import { BoardClient } from '@/components/board/board-client';
import type { PostTag } from '@prisma/client';

const PAGE_SIZE = 5;
const VALID_TAGS: PostTag[] = ['ISSUE', 'NOTICE', 'CHAT', 'RESOLVED'];

function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateStr;
}

function toParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export default async function BoardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const tenant = await requireTenant();
  const page = Math.max(1, Number(params.page) || 1);

  const keyword = toParam(params.q);
  const tagsRaw = toParam(params.tags);
  const tags = tagsRaw
    ? tagsRaw
        .split(',')
        .map((t) => t.trim())
        .filter((t): t is PostTag => VALID_TAGS.includes(t as PostTag))
    : undefined;
  const fromParam = toParam(params.from);
  const toDateParam = toParam(params.to);
  const fromDate = fromParam && isValidCalendarDate(fromParam) ? fromParam : undefined;
  const toDate = toDateParam && isValidCalendarDate(toDateParam) ? toDateParam : undefined;

  const { posts, totalCount } = await listPosts(tenant.orgId, page, PAGE_SIZE, { keyword, tags, fromDate, toDate });
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <BoardClient
      posts={posts.map((p) => ({
        id: p.id,
        tag: p.tag,
        title: p.title,
        body: p.body,
        authorId: p.authorId,
        authorName: p.author.name,
        createdAt: p.createdAt.toISOString(),
      }))}
      page={Math.min(page, totalPages)}
      totalPages={totalPages}
      totalCount={totalCount}
      currentUserId={tenant.userId}
      currentUserRole={tenant.role}
      filter={{ keyword: keyword ?? '', tags: tags ?? [], fromDate: fromDate ?? '', toDate: toDate ?? '' }}
    />
  );
}
