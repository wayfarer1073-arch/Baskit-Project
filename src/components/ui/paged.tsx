'use client';

import type { ReactNode } from 'react';
import { Pagination } from '@/components/ui/pagination';
import { usePaged } from '@/lib/use-paged';

interface PagedProps<T> {
  items: readonly T[];
  /** 검색어·필터처럼 바뀌면 1페이지로 돌아가야 하는 값. */
  resetKey?: string;
  /** 페이지 번호 줄의 여백 등. 한 페이지뿐이면 번호 줄 자체를 그리지 않는다. */
  pagerClassName?: string;
  children: (pageItems: T[], offset: number) => ReactNode;
}

/** 목록을 7개씩 나눠 보여주고 아래에 페이지 번호를 붙인다. 훅을 쓰기 어려운 자리(조건부로 그려지는 목록)용. */
export function Paged<T>({ items, resetKey = '', pagerClassName = 'mt-2', children }: PagedProps<T>) {
  const { page, totalPages, pageItems, offset, setPage } = usePaged(items, resetKey);
  return (
    <>
      {children(pageItems, offset)}
      <Pagination className={pagerClassName} page={page} totalPages={totalPages} onChange={setPage} />
    </>
  );
}
