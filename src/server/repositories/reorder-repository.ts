import { prisma } from '@/lib/prisma';
import { DEFAULT_RISK_SETTINGS } from '@/domain/inventory/types';
import { DEFAULT_REORDER_POLICY, type PolicyKey, type PolicyLayer, type SupplierPolicyRow } from '@/domain/reorder/reorder';

/** 워크스페이스 발주 기준 기본값(설정에 없는 최소발주량·발주 단위는 0·1). */
export async function getReorderDefaults(orgId: string): Promise<{ [K in PolicyKey]: number }> {
  const row = await prisma.settings.findUnique({ where: { organizationId: orgId }, select: { reorderLeadTimeDays: true, reorderSafetyDays: true, reorderTargetDays: true } });
  return {
    ...DEFAULT_REORDER_POLICY,
    ...(row ? { leadTimeDays: row.reorderLeadTimeDays, safetyDays: row.reorderSafetyDays, targetDays: row.reorderTargetDays } : {}),
  };
}

/** 거래처별 발주 기준(비어 있는 칸은 null). */
export async function loadSupplierPolicies(orgId: string): Promise<Map<string, PolicyLayer>> {
  const rows = await prisma.supplier.findMany({ where: { organizationId: orgId } });
  return new Map(
    rows.map((s) => [s.id, { leadTimeDays: s.leadTimeDays, safetyDays: s.safetyDays, targetDays: s.targetDays, minOrderQty: s.minOrderQty, orderMultiple: s.orderMultiple }]),
  );
}

export async function updateSkuReorder(
  orgId: string,
  skuId: string,
  input: { supplierId: string | null } & { [K in 'reorderLeadTimeDays' | 'reorderSafetyDays' | 'reorderTargetDays' | 'reorderMinQty' | 'reorderMultiple']: number | null },
) {
  const sku = await prisma.sku.findFirst({ where: { id: skuId, warehouse: { organizationId: orgId } }, select: { id: true } });
  if (!sku) return false;
  if (input.supplierId && !(await prisma.supplier.count({ where: { id: input.supplierId, organizationId: orgId } }))) return false;
  await prisma.sku.update({ where: { id: skuId }, data: input });
  return true;
}

export async function updateReorderDefaults(orgId: string, input: Partial<{ reorderLeadTimeDays: number; reorderSafetyDays: number; reorderTargetDays: number }>) {
  await prisma.settings.upsert({ where: { organizationId: orgId }, update: input, create: { organizationId: orgId, ...DEFAULT_RISK_SETTINGS, ...input } });
}

export async function listSupplierPolicies(orgId: string): Promise<SupplierPolicyRow[]> {
  const rows = await prisma.supplier.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' }, include: { _count: { select: { skus: true } } } });
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    leadTimeDays: s.leadTimeDays,
    safetyDays: s.safetyDays,
    targetDays: s.targetDays,
    minOrderQty: s.minOrderQty,
    orderMultiple: s.orderMultiple,
    skuCount: s._count.skus,
  }));
}
