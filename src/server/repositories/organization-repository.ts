import { hashPassword } from '@/lib/password';
import { Prisma, type BusinessSegment } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { DEFAULT_RISK_SETTINGS } from '@/domain/inventory/types';

export class EmailTakenError extends Error {}

export interface CreateWorkspaceInput {
  organizationName: string;
  segment: BusinessSegment;
  adminName: string;
  email: string;
  password: string;
  /** 기본 창고 이름 — 가입 화면 언어로. 없으면 한국어. */
  defaultWarehouseName?: string;
}

/** 가입 = 새 워크스페이스 + 첫 관리자 + 기본 창고 하나 + 기본 설정을 한 트랜잭션으로 만든다. */
export async function createWorkspace(input: CreateWorkspaceInput) {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({ data: { name: input.organizationName, segment: input.segment } });
      const user = await tx.user.create({
        data: { organizationId: organization.id, email, name: input.adminName, passwordHash, role: 'ADMIN', termsAcceptedAt: new Date() },
        select: { id: true, email: true, name: true },
      });
      await tx.warehouse.create({ data: { organizationId: organization.id, code: 'A', name: input.defaultWarehouseName ?? '기본 창고', sortOrder: 1 } });
      await tx.settings.create({ data: { organizationId: organization.id, ...DEFAULT_RISK_SETTINGS } });
      return { organization, user };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new EmailTakenError('이미 가입된 이메일입니다.');
    throw e;
  }
}

export function getOrganization(orgId: string) {
  return prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { id: true, name: true, segment: true, disabledSegments: true } });
}

/** 쓰는 대시보드 방식 목록을 바꾼다. 끈 방식의 데이터는 건드리지 않는다(화면에서만 숨김). */
export async function setDisabledSegments(orgId: string, disabled: BusinessSegment[]) {
  return prisma.organization.update({ where: { id: orgId }, data: { disabledSegments: [...new Set(disabled)] }, select: { disabledSegments: true } });
}
