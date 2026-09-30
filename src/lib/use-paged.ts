'use client';

import { useState } from 'react';
import { LIST_PAGE_SIZE } from '@/lib/paging';

export { LIST_PAGE_SIZE };

/**
 * 배열을 페이지로 나눈다. resetKey(검색어·필터 등)가 바뀌면 1페이지로 돌아가고, 항목이 줄어 현재 페이지가
 * 사라지면 마지막 페이지로 당긴다. 아래에 <Pagination page totalPages onChange={setPage} />를 붙여 쓴다.
 */
export function usePaged<T>(items: readonly T[], resetKey: string = '', size: number = LIST_PAGE_SIZE) {
  const [state, setState] = useState({ page: 1, key: resetKey });
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const requested = state.key === resetKey ? state.page : 1;
  const page = Math.min(requested, totalPages);
  return {
    page,
    totalPages,
    pageItems: items.slice((page - 1) * size, page * size),
    /** 전체에서 이 페이지 첫 항목의 위치(0부터) — 순위 번호 등에 쓴다. */
    offset: (page - 1) * size,
    setPage: (next: number) => setState({ page: next, key: resetKey }),
  };
}
