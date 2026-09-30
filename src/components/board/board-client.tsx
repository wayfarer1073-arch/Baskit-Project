'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PenSquare, Pencil, Trash2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { PostFormDialog, type EditingPost } from '@/components/board/post-form-dialog';
import { formatKstDateTime } from '@/lib/date';
import { postTagBadgeVariant, POST_TAG_OPTIONS, type PostTagValue } from '@/lib/post-tags';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { startNavigationFeedback } from '@/lib/navigation-feedback';

export interface BoardPost {
  id: string;
  tag: PostTagValue;
  title: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export interface BoardFilter {
  keyword: string;
  tags: PostTagValue[];
  fromDate: string;
  toDate: string;
}

interface BoardClientProps {
  posts: BoardPost[];
  page: number;
  totalPages: number;
  totalCount: number;
  currentUserId: string;
  currentUserRole: 'VIEWER' | 'MEMBER' | 'ADMIN';
  filter: BoardFilter;
}

function buildBoardUrl(page: number, filter: BoardFilter): string {
  const query = new URLSearchParams();
  if (page > 1) query.set('page', String(page));
  if (filter.keyword.trim() !== '') query.set('q', filter.keyword.trim());
  if (filter.tags.length > 0) query.set('tags', filter.tags.join(','));
  if (filter.fromDate) query.set('from', filter.fromDate);
  if (filter.toDate) query.set('to', filter.toDate);
  const qs = query.toString();
  return qs ? `/board?${qs}` : '/board';
}

const EMPTY_FILTER: BoardFilter = { keyword: '', tags: [], fromDate: '', toDate: '' };

export function BoardClient({ posts, page, totalPages, totalCount, currentUserId, currentUserRole, filter }: BoardClientProps) {
  const t = useI18n().m.work.board;
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<EditingPost | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BoardFilter>(filter);

  const hasActiveFilter = filter.keyword !== '' || filter.tags.length > 0 || filter.fromDate !== '' || filter.toDate !== '';

  function goToPage(next: number) {
    startNavigationFeedback();
    router.push(buildBoardUrl(next, filter));
  }

  function applyFilter() {
    // 두 날짜를 거꾸로 골라도(종료일을 시작일보다 이전으로) 바른 순서로 보정한다.
    const normalized: BoardFilter = {
      ...draft,
      fromDate: draft.fromDate && draft.toDate && draft.fromDate > draft.toDate ? draft.toDate : draft.fromDate,
      toDate: draft.fromDate && draft.toDate && draft.fromDate > draft.toDate ? draft.fromDate : draft.toDate,
    };
    startNavigationFeedback();
    router.push(buildBoardUrl(1, normalized));
  }

  function resetFilter() {
    setDraft(EMPTY_FILTER);
    startNavigationFeedback();
    router.push('/board');
  }

  function toggleDraftTag(tag: PostTagValue) {
    setDraft((prev) => ({ ...prev, tags: prev.tags.includes(tag) ? prev.tags.filter((t) => t !== tag) : [...prev.tags, tag] }));
  }

  async function handleDelete(id: string) {
    if (!confirm(t.deleteConfirm)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/posts/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? t.deleteFailed);
        return;
      }
      toast.success(t.deleted);
      router.refresh();
    } catch {
      toast.error(t.deleteNetworkFailed);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{t.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {format(hasActiveFilter ? t.results : t.total, { count: totalCount.toLocaleString() })}
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingPost(null);
            setFormOpen(true);
          }}
        >
          <PenSquare className="size-4" />
          {t.write}
        </Button>
      </div>

      <div className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={draft.keyword}
              onChange={(e) => setDraft((prev) => ({ ...prev, keyword: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && applyFilter()}
              placeholder={t.keywordPlaceholder}
              className="pl-8"
              aria-label={t.keywordAria}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="date"
                value={draft.fromDate}
                onChange={(e) => setDraft((prev) => ({ ...prev, fromDate: e.target.value }))}
                aria-label={t.fromAria}
                className="h-9 rounded-lg border bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
              ~
              <input
                type="date"
                value={draft.toDate}
                onChange={(e) => setDraft((prev) => ({ ...prev, toDate: e.target.value }))}
                aria-label={t.toAria}
                className="h-9 rounded-lg border bg-background px-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {POST_TAG_OPTIONS.map((opt) => {
              const active = draft.tags.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleDraftTag(opt.value)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t.tags[opt.value]}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5">
            {hasActiveFilter && (
              <Button variant="ghost" size="sm" onClick={resetFilter}>
                <X className="size-3.5" />
                {t.reset}
              </Button>
            )}
            <Button size="sm" onClick={applyFilter}>
              <Search className="size-3.5" />
              {t.search}
            </Button>
          </div>
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
          {hasActiveFilter ? (
            <>
              <p className="text-sm font-medium">{t.noResults}</p>
              <p className="text-xs text-muted-foreground">{t.noResultsHint}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">{t.empty}</p>
              <p className="text-xs text-muted-foreground">{t.emptyHint}</p>
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {posts.map((post) => {
            const canManage = post.authorId === currentUserId || currentUserRole === 'ADMIN';
            return (
              <li key={post.id} className="flex items-start gap-3 px-5 py-4">
                <Badge variant={postTagBadgeVariant(post.tag)} className="mt-0.5 shrink-0">
                  {t.tags[post.tag]}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{post.title}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{post.body}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {post.authorName} · {formatKstDateTime(post.createdAt)}
                  </p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      onClick={() => {
                        setEditingPost({ id: post.id, tag: post.tag, title: post.title, body: post.body });
                        setFormOpen(true);
                      }}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t.edit}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(post.id)}
                      disabled={deletingId === post.id}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      aria-label={t.delete}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Pagination page={page} totalPages={totalPages} onChange={goToPage} />

      <PostFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingPost(null);
        }}
        editingPost={editingPost}
        onCreated={() => {
          if (editingPost) {
            router.refresh();
          } else if (page === 1) {
            router.refresh();
          } else {
            goToPage(1);
          }
        }}
      />
    </div>
  );
}
