import { describe, expect, it } from 'vitest';
import { bumpDataRevision, dataRevision, isWriteOperation, lastWriteAt } from './data-revision';

describe('data revision', () => {
  it('treats every non-read operation as a write, including unknown ones', () => {
    for (const op of ['findMany', 'findUnique', 'findFirst', 'count', 'aggregate', 'groupBy', '$queryRaw']) expect(isWriteOperation(op)).toBe(false);
    for (const op of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', '$executeRaw', 'somethingNew']) expect(isWriteOperation(op)).toBe(true);
  });

  it('bumps the revision and remembers when the write happened', () => {
    const before = dataRevision();
    bumpDataRevision();
    expect(dataRevision()).toBe(before + 1);
    expect(Date.now() - lastWriteAt()).toBeLessThan(1000);
  });
});
