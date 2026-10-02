/**
 * DB 쓰기 횟수 — 어떤 쓰기든 일어나면 1 올라간다(prisma 클라이언트의 쿼리 확장이 올린다).
 * 대시보드 계산 결과는 이 값이 바뀌지 않은 동안만 재사용한다. 서버 프로세스 하나 안에서만 의미가 있다.
 */
const store = globalThis as unknown as { __limenoteDataRevision?: number; __limenoteLastWriteAt?: number };

export function dataRevision(): number {
  return store.__limenoteDataRevision ?? 0;
}

export function bumpDataRevision(): void {
  store.__limenoteDataRevision = dataRevision() + 1;
  store.__limenoteLastWriteAt = Date.now();
}

/** 마지막 쓰기 시각(ms). 트랜잭션 안의 쓰기는 커밋 전에 리비전이 오르므로, 직후 잠깐은 결과를 저장하지 않는 데 쓴다. */
export function lastWriteAt(): number {
  return store.__limenoteLastWriteAt ?? 0;
}

const READ_ONLY = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy', '$queryRaw', '$queryRawUnsafe']);

/** 읽기가 아닌 모든 연산(create·update·upsert·delete·*Many·$executeRaw…)은 쓰기로 본다 — 모르는 연산도 안전하게 무효화한다. */
export function isWriteOperation(operation: string): boolean {
  return !READ_ONLY.has(operation);
}
