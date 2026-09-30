import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { StockSegment } from '@/server/repositories/warehouse-repository';

export interface RegisteredCostRow {
  skuId: string;
  warehouseId: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  unitCost: number;
  source: 'FILE' | 'MANUAL' | null;
  updatedAt: string | null;
}

/** 원가가 한 번이라도 등록된(현재 원가 > 0) 품목. 보관한 창고는 뺀다. 매장 품목(가상 창고)도 함께 보여 준다. */
export async function listRegisteredCosts(orgId: string, segment?: StockSegment): Promise<RegisteredCostRow[]> {
  const skus = await prisma.sku.findMany({
    where: {
      currentUnitCost: { gt: 0 },
      // 방식을 주면 그 방식의 창고 품목만(설정의 일일 재고 연동·비정기 실사 탭). 매장 품목 원가는 매장 탭의 품목 추가 정보에서 다룬다.
      warehouse: segment ? { organizationId: orgId, isArchived: false, kind: 'STOCK', segment } : { organizationId: orgId, isArchived: false },
      NOT: { isActive: false, warehouse: { kind: 'STORE' } }, // 보관한 매장 품목은 뺀다
    },
    orderBy: [{ warehouse: { sortOrder: 'asc' } }, { productCode: 'asc' }],
    select: {
      id: true,
      productCode: true,
      currentProductName: true,
      currentUnitCost: true,
      unitCostSource: true,
      unitCostUpdatedAt: true,
      warehouse: { select: { id: true, name: true } },
    },
  });
  return skus.map((s) => ({
    skuId: s.id,
    warehouseId: s.warehouse.id,
    warehouseName: s.warehouse.name,
    productCode: s.productCode,
    productName: s.currentProductName,
    unitCost: Number(s.currentUnitCost),
    source: s.unitCostSource,
    updatedAt: s.unitCostUpdatedAt?.toISOString() ?? null,
  }));
}

/**
 * 품목 원가를 직접 정하거나(unitCost) 지운다(null → 0원).
 *
 * 원가는 관측(재고 행)마다 "명시 원가"가 있으면 그 날부터 새 기준이 되는 방식이라, 직접 정한 원가도 그 품목의 가장 최근 관측에
 * 명시 원가로 기록한다 — 그날 이후 원가가 비어 있는 업로드는 이 값을 이어받고, 이후 파일에 원가가 있으면 파일 값이 새 기준이 된다.
 * 과거 관측의 원가는 바꾸지 않는다. 덮어쓴 원래 값은 행의 extra.manualCost에 남긴다.
 */
export async function setSkuUnitCost(orgId: string, skuId: string, unitCost: number | null): Promise<boolean> {
  const sku = await prisma.sku.findFirst({ where: { id: skuId, warehouse: { organizationId: orgId } }, select: { id: true } });
  if (!sku) return false;
  const value = unitCost ?? 0;
  await prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.findFirst({
      where: { skuId, snapshot: { status: 'ACTIVE' } },
      orderBy: { snapshot: { snapshotDate: 'desc' } },
      select: { snapshotId: true, unitCost: true, unitCostProvided: true, totalCost: true, extra: true },
    });
    if (item) {
      const extra = (item.extra && typeof item.extra === 'object' && !Array.isArray(item.extra) ? item.extra : {}) as Prisma.JsonObject;
      const previous = (extra.manualCost as Prisma.JsonObject | undefined)?.original ?? {
        unitCost: Number(item.unitCost),
        unitCostProvided: item.unitCostProvided,
        totalCost: item.totalCost === null ? null : Number(item.totalCost),
      };
      await tx.inventoryItem.update({
        where: { snapshotId_skuId: { snapshotId: item.snapshotId, skuId } },
        // 파일의 원가합이 남아 있으면 그날 금액이 직접 정한 원가를 따르지 않으므로 원가합은 비운다.
        data: { unitCost: value, unitCostProvided: true, totalCost: null, extra: { ...extra, manualCost: { value, at: new Date().toISOString(), original: previous } } },
      });
    }
    await tx.sku.update({ where: { id: skuId }, data: { currentUnitCost: value, unitCostSource: unitCost ? 'MANUAL' : null, unitCostUpdatedAt: new Date() } });
  });
  return true;
}
