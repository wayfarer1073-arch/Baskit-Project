import { prisma } from '@/lib/prisma';

export async function listFavoriteSkuIds(userId: string): Promise<string[]> {
  const rows = await prisma.skuFavorite.findMany({ where: { userId }, select: { skuId: true } });
  return rows.map((r) => r.skuId);
}

/** 즐겨찾기는 사용자 소유지만, 대상 SKU는 반드시 같은 조직의 것이어야 한다. */
export async function addFavorite(orgId: string, userId: string, skuId: string): Promise<boolean> {
  const sku = await prisma.sku.findFirst({ where: { id: skuId, warehouse: { organizationId: orgId } }, select: { id: true } });
  if (!sku) return false;
  await prisma.skuFavorite.upsert({
    where: { userId_skuId: { userId, skuId } },
    update: {},
    create: { userId, skuId },
  });
  return true;
}

export async function removeFavorite(userId: string, skuId: string): Promise<void> {
  await prisma.skuFavorite.deleteMany({ where: { userId, skuId } });
}
