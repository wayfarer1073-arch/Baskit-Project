import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { DEFAULT_RISK_SETTINGS, type RiskThresholdSettings } from '@/domain/inventory/types';

/**
 * 설정 행을 읽고, 없으면 기본값으로 만든다. 한 요청 안에서 여러 곳이 동시에 부르면 upsert끼리 경합해
 * 고유키 오류가 날 수 있어(새 워크스페이스의 첫 화면), 먼저 읽고 만들 때 경합에 지면 다시 읽는다.
 */
async function ensureSettingsRow(orgId: string) {
  const existing = await prisma.settings.findUnique({ where: { organizationId: orgId } });
  if (existing) return existing;
  try {
    return await prisma.settings.create({ data: { organizationId: orgId, ...DEFAULT_RISK_SETTINGS } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return prisma.settings.findUniqueOrThrow({ where: { organizationId: orgId } });
    throw e;
  }
}

export async function getSettings(orgId: string): Promise<RiskThresholdSettings> {
  const row = await ensureSettingsRow(orgId);
  return {
    stockoutSoonDays: row.stockoutSoonDays,
    manageMaxDays: row.manageMaxDays,
    overstockCoverageDays: row.overstockCoverageDays,
    stagnantDays: row.stagnantDays,
  };
}

export async function updateSettings(orgId: string, input: Partial<RiskThresholdSettings>) {
  return prisma.settings.upsert({
    where: { organizationId: orgId },
    update: input,
    create: { organizationId: orgId, ...DEFAULT_RISK_SETTINGS, ...input },
  });
}

export interface SegmentSettings {
  /** 비정기 실사: 마지막 실사 후 이 일수가 지나면 다시 세어보길 권한다. */
  periodicRecountDays: number;
  /** 매장 발주 예측: 남은 매출 여유가 충족 매출의 이 퍼센트 이하면 '발주 확인 필요'. */
  storeCheckRemainingPct: number;
}

export async function getSegmentSettings(orgId: string): Promise<SegmentSettings> {
  const row = await ensureSettingsRow(orgId);
  return { periodicRecountDays: row.periodicRecountDays, storeCheckRemainingPct: row.storeCheckRemainingPct };
}

export async function updateSegmentSettings(orgId: string, input: Partial<SegmentSettings>) {
  return prisma.settings.upsert({
    where: { organizationId: orgId },
    update: input,
    create: { organizationId: orgId, ...DEFAULT_RISK_SETTINGS, ...input },
  });
}
