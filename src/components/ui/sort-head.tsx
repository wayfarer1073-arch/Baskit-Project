'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { sortByColumn, type SortDir, type SortValue } from '@/lib/column-sort';

export type { SortDir, SortValue } from '@/lib/column-sort';

/**
 * 열 머리글을 눌러 정렬한다: 오름차순 → 내림차순 → 원래 순서. 값이 없는 행(null)은 방향과 상관없이 맨 아래.
 * accessors는 열 키별로 행에서 정렬 값을 꺼내는 함수다.
 */
export function useColumnSort<T, K extends string>(items: readonly T[], accessors: Record<K, (row: T) => SortValue>) {
  const [sort, setSort] = useState<{ key: K; dir: SortDir } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return items as T[];
    return sortByColumn(items, accessors[sort.key], sort.dir);
    // accessors는 렌더마다 새로 만들어도 정렬 기준(열 키)이 같으면 결과가 같다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sort]);
  const toggle = (key: K) => setSort((prev) => (prev?.key !== key ? { key, dir: 'asc' } : prev.dir === 'asc' ? { key, dir: 'desc' } : null));
  const dirOf = (key: K): SortDir | null => (sort?.key === key ? sort.dir : null);
  return { sorted, toggle, dirOf, sortKey: sort ? `${sort.key}:${sort.dir}` : '' };
}

/** 누르면 정렬이 바뀌는 표 머리글. 현재 방향을 화살표와 aria-sort로 알려준다. */
export function SortHead({ label, dir, onClick, className }: { label: string; dir: SortDir | null; onClick: () => void; className?: string }) {
  const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <TableHead className={className} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground',
          dir && 'text-foreground',
          className?.includes('text-right') && 'flex-row-reverse',
        )}
      >
        <Icon className={cn('size-3 shrink-0', !dir && 'opacity-40')} aria-hidden="true" />
        {label}
      </button>
    </TableHead>
  );
}
