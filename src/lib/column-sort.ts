export type SortDir = 'asc' | 'desc';
export type SortValue = number | string | null;

/** 한 열 기준으로 정렬한 새 배열. 값이 없는 행(null)은 방향과 상관없이 맨 아래, 값이 같으면 원래 순서를 지킨다. */
export function sortByColumn<T>(items: readonly T[], get: (row: T) => SortValue, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return items
    .map((row, index) => ({ row, index, value: get(row) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) return a.value === b.value ? a.index - b.index : a.value === null ? 1 : -1;
      const cmp = typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : String(a.value).localeCompare(String(b.value));
      return cmp !== 0 ? cmp * sign : a.index - b.index;
    })
    .map((x) => x.row);
}
