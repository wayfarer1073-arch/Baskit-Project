import bcrypt from 'bcryptjs';
import { Prisma, type Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export function listUsers(orgId: string) {
  return prisma.user.findMany({
    where: { organizationId: orgId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
}

export function getUserRole(orgId: string, userId: string) {
  return prisma.user.findFirst({ where: { id: userId, organizationId: orgId }, select: { role: true, isActive: true, email: true } });
}

export function countActiveAdmins(orgId: string) {
  return prisma.user.count({ where: { organizationId: orgId, role: 'ADMIN', isActive: true } });
}

export async function createUser(orgId: string, input: { email: string; name: string; password: string; role: Role }) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  return prisma.user.create({
    data: { organizationId: orgId, email: input.email.trim().toLowerCase(), name: input.name, passwordHash, role: input.role },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
}

/**
 * 업로드/이벤트/게시글 등 참조 이력이 없는 계정은 실제로 삭제하고, 이력이 있어 참조 무결성상
 * 지울 수 없는 계정은 로그인만 차단(isActive=false)한다. 어느 쪽이든 목록에서는 즉시 사라진다.
 */
export async function deleteUser(userId: string): Promise<{ mode: 'hard' | 'soft' }> {
  try {
    await prisma.user.delete({ where: { id: userId } });
    return { mode: 'hard' };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
      return { mode: 'soft' };
    }
    throw e;
  }
}
