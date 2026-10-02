import { PrismaClient } from '@prisma/client';
import { bumpDataRevision, isWriteOperation } from '@/lib/data-revision';

/**
 * 쓰기 연산이 끝날 때마다 데이터 리비전을 올려 대시보드 계산 캐시를 무효화한다.
 * 확장 클라이언트의 타입은 기존 코드와 같은 PrismaClient로 맞춘다(쿼리 확장은 동작만 덧붙이고 API는 그대로다).
 */
function createClient(): PrismaClient {
  return new PrismaClient().$extends({
    query: {
      async $allOperations({ operation, args, query }) {
        if (!isWriteOperation(operation)) return query(args);
        try {
          return await query(args);
        } finally {
          bumpDataRevision();
        }
      },
    },
  }) as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
