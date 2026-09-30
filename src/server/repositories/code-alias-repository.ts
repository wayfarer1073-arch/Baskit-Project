import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PackagingFactors } from '@/domain/excel/normalize';

export interface CodeAliasRow {
  id: string;
  warehouseId: string;
  warehouseName: string;
  externalCode: string;
  skuId: string;
  productCode: string;
  productName: string;
}

export class CodeAliasError extends Error {}

export async function listCodeAliases(orgId: string): Promise<CodeAliasRow[]> {
  const rows = await prisma.skuCodeAlias.findMany({
    where: { warehouse: { organizationId: orgId, isArchived: false, kind: 'STOCK' } },
    include: { warehouse: { select: { name: true } }, sku: { select: { productCode: true, currentProductName: true } } },
    orderBy: [{ warehouseId: 'asc' }, { externalCode: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    warehouseId: r.warehouseId,
    warehouseName: r.warehouse.name,
    externalCode: r.externalCode,
    skuId: r.skuId,
    productCode: r.sku.productCode,
    productName: r.sku.currentProductName,
  }));
}

/** 파일에 이 코드로 들어오는 행을 기존 SKU로 잇는다. 같은 창고의 SKU만, 자기 자신의 코드는 연결할 수 없다. */
export async function createCodeAlias(orgId: string, input: { warehouseId: string; externalCode: string; skuId: string }) {
  const sku = await prisma.sku.findFirst({ where: { id: input.skuId, warehouseId: input.warehouseId, warehouse: { organizationId: orgId } } });
  if (!sku) return null;
  if (sku.productCode === input.externalCode) throw new CodeAliasError('상품의 원래 코드와 같은 코드는 연결할 수 없습니다.');
  try {
    return await prisma.skuCodeAlias.create({ data: input });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new CodeAliasError('이 창고에 이미 연결된 코드입니다.');
    throw e;
  }
}

export async function deleteCodeAlias(orgId: string, id: string) {
  const result = await prisma.skuCodeAlias.deleteMany({ where: { id, warehouse: { organizationId: orgId } } });
  return result.count > 0;
}

/** 업로드용 — 외부 코드 → 연결된 SKU의 상품코드. */
export async function loadAliasMap(warehouseId: string): Promise<Map<string, string>> {
  const rows = await prisma.skuCodeAlias.findMany({ where: { warehouseId }, select: { externalCode: true, sku: { select: { productCode: true } } } });
  return new Map(rows.map((r) => [r.externalCode, r.sku.productCode]));
}

/** 업로드용 — 창고 SKU의 입수량과 이미 아는 상품코드 목록. */
export async function loadWarehouseSkuInfo(
  warehouseId: string,
): Promise<{ factors: Map<string, PackagingFactors>; knownCodes: Set<string>; codeByName: Map<string, string> }> {
  const skus = await prisma.sku.findMany({
    where: { warehouseId },
    orderBy: [{ isActive: 'desc' }, { lastSeenDate: 'desc' }],
    select: { productCode: true, currentProductName: true, eaPerBox: true, eaPerPallet: true },
  });
  const codeByName = new Map<string, string>();
  // 같은 이름이 여러 품목이면 지금 쓰이는(최근에 본) 품목을 고른다.
  for (const s of skus) if (!codeByName.has(s.currentProductName)) codeByName.set(s.currentProductName, s.productCode);
  return {
    factors: new Map(skus.map((s) => [s.productCode, { eaPerBox: s.eaPerBox, eaPerPallet: s.eaPerPallet }])),
    knownCodes: new Set(skus.map((s) => s.productCode)),
    codeByName,
  };
}
