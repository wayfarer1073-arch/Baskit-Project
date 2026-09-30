import { prisma } from '@/lib/prisma';

export interface MergeLinkRow {
  skuId: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  mergeKey: string;
}

/** 창고 간 같은 품목으로 직접 묶어 둔 품목(상품코드가 같아 자동으로 묶이는 경우는 제외). */
export async function listMergeLinks(orgId: string): Promise<MergeLinkRow[]> {
  const rows = await prisma.sku.findMany({
    where: { mergeKey: { not: null }, warehouse: { organizationId: orgId, isArchived: false, kind: 'STOCK' } },
    orderBy: [{ mergeKey: 'asc' }, { productCode: 'asc' }],
    select: { id: true, productCode: true, currentProductName: true, mergeKey: true, warehouse: { select: { name: true } } },
  });
  return rows.map((r) => ({ skuId: r.id, warehouseName: r.warehouse.name, productCode: r.productCode, productName: r.currentProductName, mergeKey: r.mergeKey! }));
}

export class MergeLinkError extends Error {}

/**
 * skuId를 targetSkuId와 같은 품목으로 묶는다(대상의 묶음 키 = 대상이 이미 묶여 있으면 그 키, 아니면 대상의 상품코드).
 * targetSkuId가 null이면 묶음을 풀어 다시 자기 상품코드로 묶인다. 같은 창고 안의 품목끼리는 묶지 않는다.
 */
export async function setSkuMerge(orgId: string, skuId: string, targetSkuId: string | null): Promise<boolean> {
  const sku = await prisma.sku.findFirst({ where: { id: skuId, warehouse: { organizationId: orgId } }, select: { id: true, warehouseId: true } });
  if (!sku) return false;
  if (targetSkuId === null) {
    await prisma.sku.update({ where: { id: skuId }, data: { mergeKey: null } });
    return true;
  }
  const target = await prisma.sku.findFirst({ where: { id: targetSkuId, warehouse: { organizationId: orgId } }, select: { warehouseId: true, productCode: true, mergeKey: true } });
  if (!target) return false;
  if (target.warehouseId === sku.warehouseId) throw new MergeLinkError('같은 창고의 품목끼리는 묶을 수 없어요. 창고 안에서 코드가 바뀐 경우는 상품코드 연결을 쓰세요.');
  await prisma.sku.update({ where: { id: skuId }, data: { mergeKey: target.mergeKey ?? target.productCode } });
  return true;
}
