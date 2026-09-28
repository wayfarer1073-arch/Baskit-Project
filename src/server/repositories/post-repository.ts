import { prisma } from '@/lib/prisma';
import { kstDateStartToUtc, kstDateEndToUtc } from '@/lib/date';
import type { Prisma, PostTag, Role } from '@prisma/client';

export class PostPermissionError extends Error {}
export class PostNotFoundError extends Error {}

export interface ListPostsFilter {
  keyword?: string;
  tags?: PostTag[];
  /** KST 달력 날짜('yyyy-MM-dd'). 같은 날짜를 from/to에 넣으면 그날 하루만 조회된다. */
  fromDate?: string;
  toDate?: string;
}

function buildPostWhere(orgId: string, filter: ListPostsFilter): Prisma.PostWhereInput {
  const keyword = filter.keyword?.trim();
  return {
    organizationId: orgId,
    ...(filter.tags && filter.tags.length > 0 ? { tag: { in: filter.tags } } : {}),
    ...(keyword ? { OR: [{ title: { contains: keyword, mode: 'insensitive' } }, { body: { contains: keyword, mode: 'insensitive' } }] } : {}),
    ...(filter.fromDate || filter.toDate
      ? {
          createdAt: {
            ...(filter.fromDate ? { gte: kstDateStartToUtc(filter.fromDate) } : {}),
            ...(filter.toDate ? { lte: kstDateEndToUtc(filter.toDate) } : {}),
          },
        }
      : {}),
  };
}

export async function listPosts(orgId: string, page: number, pageSize: number, filter: ListPostsFilter = {}) {
  const skip = (page - 1) * pageSize;
  const where = buildPostWhere(orgId, filter);
  const [posts, totalCount] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: { author: { select: { id: true, name: true } } },
    }),
    prisma.post.count({ where }),
  ]);
  return { posts, totalCount };
}

export function createPost(orgId: string, input: { tag: PostTag; title: string; body: string; authorId: string }) {
  return prisma.post.create({ data: { ...input, organizationId: orgId }, include: { author: { select: { id: true, name: true } } } });
}

export async function updatePost(orgId: string, id: string, requester: { id: string; role: Role }, patch: { tag: PostTag; title: string; body: string }) {
  const post = await prisma.post.findFirst({ where: { id, organizationId: orgId } });
  if (!post) throw new PostNotFoundError('게시글을 찾을 수 없습니다.');
  if (post.authorId !== requester.id && requester.role !== 'ADMIN') {
    throw new PostPermissionError('본인 글 또는 관리자만 수정할 수 있습니다.');
  }
  return prisma.post.update({ where: { id }, data: patch, include: { author: { select: { id: true, name: true } } } });
}

export async function deletePost(orgId: string, id: string, requester: { id: string; role: Role }) {
  const post = await prisma.post.findFirst({ where: { id, organizationId: orgId } });
  if (!post) throw new PostNotFoundError('게시글을 찾을 수 없습니다.');
  if (post.authorId !== requester.id && requester.role !== 'ADMIN') {
    throw new PostPermissionError('본인 글 또는 관리자만 삭제할 수 있습니다.');
  }
  await prisma.post.delete({ where: { id } });
}

const SIDEBAR_TAG_ORDER: PostTag[] = ['NOTICE', 'ISSUE', 'RESOLVED', 'CHAT'];

export interface LatestPostByTag {
  id: string;
  tag: PostTag;
  title: string;
}

/** 사이드바 미리보기용 — 태그별 가장 최근 글 제목 1건씩(글이 없는 태그는 결과에서 빠진다). */
export async function listLatestPostPerTag(orgId: string): Promise<LatestPostByTag[]> {
  const results = await Promise.all(
    SIDEBAR_TAG_ORDER.map((tag) => prisma.post.findFirst({ where: { organizationId: orgId, tag }, orderBy: { createdAt: 'desc' }, select: { id: true, tag: true, title: true } })),
  );
  return results.filter((r): r is LatestPostByTag => r !== null);
}
