import { describe, expect, it } from 'vitest';
import { sortByColumn } from './column-sort';

const rows = [
  { id: 'a', qty: 5 as number | null, name: '나' },
  { id: 'b', qty: null, name: '가' },
  { id: 'c', qty: 1, name: '다' },
  { id: 'd', qty: 5, name: '가' },
];

describe('sortByColumn', () => {
  it('숫자를 오름차순·내림차순으로 정렬하고 값이 같으면 원래 순서를 지킨다', () => {
    expect(sortByColumn(rows, (r) => r.qty, 'asc').map((r) => r.id)).toEqual(['c', 'a', 'd', 'b']);
    expect(sortByColumn(rows, (r) => r.qty, 'desc').map((r) => r.id)).toEqual(['a', 'd', 'c', 'b']);
  });

  it('값이 없는 행은 방향과 상관없이 맨 아래에 둔다', () => {
    expect(sortByColumn(rows, (r) => r.qty, 'asc').at(-1)?.id).toBe('b');
    expect(sortByColumn(rows, (r) => r.qty, 'desc').at(-1)?.id).toBe('b');
  });

  it('문자열(이름·날짜)도 정렬하고 원본 배열은 바꾸지 않는다', () => {
    const before = rows.map((r) => r.id);
    expect(sortByColumn(rows, (r) => r.name, 'asc').map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});
