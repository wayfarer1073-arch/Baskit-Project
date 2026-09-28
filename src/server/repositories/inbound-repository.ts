import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';

export interface InboundEntryRow {
  id: string;
  skuId: string;
  productCode: string;
  productName: string;
  quantity: number;
}

/**
 * 특정 창고·날짜에 기록된 입고 특이사항 목록. 스냅샷 버전과 무관하게 (SKU, 날짜) 자체로 조회한다.
 * isActive(최근 스냅샷 존재 여부)로 거르지 않는다 — 최근 업로드에서 빠진 SKU에 입고를 기록한
 * 경우에도 그 기록이 캘린더에서 사라지면 안 된다.
 */
export function listInboundEntriesForDate(warehouseId: string, date: string): Promise<InboundEntryRow[]> {
  return prisma.snapshotInbound.findMany({
    where: { snapshotDate: new Date(`${date}T00:00:00.000Z`), sku: { warehouseId } },
    orderBy: { productCode: 'asc' },
  });
}

/** 업로드 캘린더의 창고별 "입고 특이사항 N건" 뱃지용 — 전체 창고·날짜별 건수를 한 번에 로드한다(N+1 방지). */
export async function listInboundCountsByWarehouseAndDate(orgId: string): Promise<Map<string, number>> {
  const entries = await prisma.snapshotInbound.findMany({
    where: { sku: { warehouse: { organizationId: orgId } } },
    select: { snapshotDate: true, sku: { select: { warehouseId: true } } },
  });
  const map = new Map<string, number>();
  for (const entry of entries) {
    const key = `${entry.sku.warehouseId}|${dateOnlyToString(entry.snapshotDate)}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

const INT32_MAX = 2_147_483_647;

export interface AddInboundEntryInput {
  warehouseId: string;
  skuId: string;
  date: string;
  quantity: number;
}

export type AddInboundEntryResult = { ok: true; entry: InboundEntryRow } | { ok: false; error: string };

/** 같은 (SKU, 날짜)에 이미 기록이 있으면 수량을 더한다(하루에 여러 번 나눠 입고된 경우를 그대로 반영). */
export async function addInboundEntry(input: AddInboundEntryInput): Promise<AddInboundEntryResult> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > INT32_MAX) {
    return { ok: false, error: '입고 수량은 허용 범위 안의 양의 정수여야 합니다.' };
  }
  return prisma.$transaction(async (tx) => {
    // Lock the parent SKU, including when no inbound row exists yet. The overflow check and
    // write now see the latest committed total; simultaneous first inserts cannot race either.
    await tx.$queryRaw`SELECT id FROM skus WHERE id = ${input.skuId} FOR UPDATE`;
    const sku = await tx.sku.findUnique({ where: { id: input.skuId } });
    // isActive는 검사하지 않는다 — 최근 스냅샷에서 빠진 SKU라도(재고가 바닥나 한동안 업로드
    // 목록에 없었을 뿐인 경우 등) 새로 들어오는 입고는 기록할 수 있어야 한다.
    if (!sku || sku.warehouseId !== input.warehouseId) {
      return { ok: false, error: '해당 창고에 속한 SKU가 아닙니다.' };
    }

    const snapshotDate = new Date(`${input.date}T00:00:00.000Z`);
    const existing = await tx.snapshotInbound.findUnique({
      where: { skuId_snapshotDate: { skuId: input.skuId, snapshotDate } },
    });
    const nextQuantity = (existing?.quantity ?? 0) + input.quantity;
    if (nextQuantity > INT32_MAX) {
      return { ok: false, error: '같은 상품의 입고 수량 합계가 허용 범위를 초과합니다.' };
    }

    const entry = await tx.snapshotInbound.upsert({
      where: { skuId_snapshotDate: { skuId: input.skuId, snapshotDate } },
      create: {
        skuId: input.skuId,
        snapshotDate,
        productCode: sku.productCode,
        productName: sku.currentProductName,
        quantity: input.quantity,
      },
      update: { quantity: { increment: input.quantity }, productCode: sku.productCode, productName: sku.currentProductName },
    });
    return { ok: true, entry };
  });
}

export async function deleteInboundEntry(orgId: string, id: string): Promise<boolean> {
  const result = await prisma.snapshotInbound.deleteMany({ where: { id, sku: { warehouse: { organizationId: orgId } } } });
  return result.count > 0;
}
