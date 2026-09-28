import { prisma } from '@/lib/prisma';
import { DEFAULT_RISK_SETTINGS, type RiskThresholdSettings } from '@/domain/inventory/types';

export async function getSettings(orgId: string): Promise<RiskThresholdSettings> {
  const row = await prisma.settings.upsert({
    where: { organizationId: orgId },
    update: {},
    create: { organizationId: orgId, ...DEFAULT_RISK_SETTINGS },
  });
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
