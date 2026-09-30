import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';
import type { OrderEntryRow, SalesEntryRow } from '@/domain/segments/read-model';

function toDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export class StoreItemNameTakenError extends Error {}

export class SupplierNameTakenError extends Error {}

export interface StoreItemRow {
  id: string;
  name: string;
  unit: string;
  /** 실제로 쓰는 리드타임 — 발주처가 있으면 발주처 값, 없으면 품목 값. */
  leadTimeDays: number;
  itemLeadTimeDays: number;
  supplierId: string | null;
  supplierName: string | null;
  orders: { date: string; quantity: number; coverageAmount: number | null; leftoverQuantity: number | null }[];
}

const num = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
const DEFAULT_UNIT = '개';
const DEFAULT_LEAD_TIME = 1;

// ── '매장 품목' 가상 창고 ───────────────────────────────────────────────────────────────────────
// 매장 품목은 조직마다 하나 있는 STORE 창고의 SKU다. 그래서 메모/이벤트·캘린더 일정·검색을 재고 SKU와 같은 체계로 쓴다.
// 재고 화면(대시보드·업로드·설정 창고 목록)은 STOCK 창고만 보므로 여기 품목은 섞이지 않는다. 보관한 품목은 isActive=false.

export const STORE_WAREHOUSE_CODE = 'STORE';

/** 조직의 매장 품목 창고(없으면 null). */
export function findStoreWarehouse(orgId: string) {
  return prisma.warehouse.findFirst({ where: { organizationId: orgId, kind: 'STORE' }, select: { id: true } });
}

/** 매장 품목 창고를 찾고, 없으면 만든다(첫 품목을 등록할 때). */
export async function ensureStoreWarehouse(orgId: string): Promise<string> {
  const existing = await findStoreWarehouse(orgId);
  if (existing) return existing.id;
  try {
    const created = await prisma.warehouse.create({ data: { organizationId: orgId, code: STORE_WAREHOUSE_CODE, name: '매장 품목', kind: 'STORE', sortOrder: 9999 } });
    return created.id;
  } catch (e) {
    // 동시에 두 요청이 만들려 하면 한쪽은 코드 중복으로 실패한다 — 먼저 만든 창고를 쓴다.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return (await findStoreWarehouse(orgId))!.id;
    throw e;
  }
}

const storeItemWhere = (orgId: string) => ({ isActive: true, warehouse: { organizationId: orgId, kind: 'STORE' as const } });

export async function listStoreItemsWithOrders(orgId: string, asOfDate?: string): Promise<StoreItemRow[]> {
  const items = await prisma.sku.findMany({
    where: storeItemWhere(orgId),
    orderBy: { currentProductName: 'asc' },
    include: {
      purchaseOrders: {
        where: asOfDate ? { orderDate: { lte: toDateOnly(asOfDate) } } : undefined,
        orderBy: { orderDate: 'asc' },
        select: { orderDate: true, quantity: true, coverageAmount: true, leftoverQuantity: true },
      },
      supplier: { select: { id: true, name: true, leadTimeDays: true } },
    },
  });
  return items.map((item) => {
    const itemLeadTimeDays = item.reorderLeadTimeDays ?? DEFAULT_LEAD_TIME;
    return {
      id: item.id,
      name: item.currentProductName,
      unit: item.unit ?? DEFAULT_UNIT,
      leadTimeDays: item.supplier?.leadTimeDays ?? itemLeadTimeDays,
      itemLeadTimeDays,
      supplierId: item.supplier?.id ?? null,
      supplierName: item.supplier?.name ?? null,
      orders: item.purchaseOrders.map((o) => ({
        date: dateOnlyToString(o.orderDate),
        quantity: Number(o.quantity),
        coverageAmount: num(o.coverageAmount),
        leftoverQuantity: num(o.leftoverQuantity),
      })),
    };
  });
}

async function supplierBelongs(orgId: string, supplierId: string | null | undefined) {
  if (!supplierId) return true;
  return (await prisma.supplier.count({ where: { id: supplierId, organizationId: orgId } })) > 0;
}

export interface StoreItemInput {
  name: string;
  unit: string;
  leadTimeDays: number;
  supplierId?: string | null;
}

async function nameTaken(orgId: string, name: string, exceptId?: string) {
  return (await prisma.sku.count({ where: { ...storeItemWhere(orgId), currentProductName: name, ...(exceptId ? { NOT: { id: exceptId } } : {}) } })) > 0;
}

/** 매장 품목 등록 — 매장 품목 창고에 SKU를 만든다(상품코드는 S0001처럼 자동). */
export async function createStoreItem(orgId: string, input: StoreItemInput) {
  if (!(await supplierBelongs(orgId, input.supplierId))) return null;
  if (await nameTaken(orgId, input.name)) throw new StoreItemNameTakenError('같은 이름의 품목이 이미 있어요.');
  const warehouseId = await ensureStoreWarehouse(orgId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM warehouses WHERE id = ${warehouseId} FOR UPDATE`;
    const count = await tx.sku.count({ where: { warehouseId } });
    const today = toDateOnly(new Date().toISOString().slice(0, 10));
    return tx.sku.create({
      data: {
        warehouseId,
        productCode: `S${String(count + 1).padStart(4, '0')}`,
        currentProductName: input.name,
        unit: input.unit,
        reorderLeadTimeDays: input.leadTimeDays,
        supplierId: input.supplierId ?? null,
        firstSeenDate: today,
        lastSeenDate: today,
      },
    });
  });
}

export async function updateStoreItem(orgId: string, id: string, input: Partial<StoreItemInput>) {
  if (!(await supplierBelongs(orgId, input.supplierId))) return false;
  if (input.name !== undefined && (await nameTaken(orgId, input.name, id))) throw new StoreItemNameTakenError('같은 이름의 품목이 이미 있어요.');
  const result = await prisma.sku.updateMany({
    where: { id, ...storeItemWhere(orgId) },
    data: {
      ...(input.name !== undefined ? { currentProductName: input.name } : {}),
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
      ...(input.leadTimeDays !== undefined ? { reorderLeadTimeDays: input.leadTimeDays } : {}),
      ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
    },
  });
  return result.count > 0;
}

/** 발주 기록이 예측의 근거라 품목은 지우지 않고 보관한다(같은 이름으로 다시 만들 수 있다). */
export async function archiveStoreItem(orgId: string, id: string) {
  const result = await prisma.sku.updateMany({ where: { id, ...storeItemWhere(orgId) }, data: { isActive: false } });
  return result.count > 0;
}

export async function listRecentOrders(orgId: string, limit = 40, itemId?: string): Promise<OrderEntryRow[]> {
  const orders = await prisma.purchaseOrder.findMany({
    where: { sku: storeItemWhere(orgId), ...(itemId ? { skuId: itemId } : {}) },
    orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: { sku: { select: { currentProductName: true, unit: true } }, createdBy: { select: { name: true } } },
  });
  return orders.map((o) => ({
    id: o.id,
    itemId: o.skuId,
    itemName: o.sku.currentProductName,
    unit: o.sku.unit ?? DEFAULT_UNIT,
    date: dateOnlyToString(o.orderDate),
    quantity: Number(o.quantity),
    coverageAmount: num(o.coverageAmount),
    leftoverQuantity: num(o.leftoverQuantity),
    createdByName: o.createdBy.name,
  }));
}

export interface OrderLineInput {
  itemId: string;
  quantity: number;
  coverageAmount: number | null;
  /** 발주를 넣을 때 남아 있던 양(모르면 null). */
  leftoverQuantity: number | null;
}

/** 같은 날 여러 품목을 한 번에 발주 기록한다. 하나라도 이 조직의 품목이 아니면 아무것도 저장하지 않는다. */
export async function addPurchaseOrders(orgId: string, input: { date: string; lines: OrderLineInput[]; createdById: string }): Promise<number | null> {
  const ids = [...new Set(input.lines.map((l) => l.itemId))];
  const owned = await prisma.sku.count({ where: { id: { in: ids }, ...storeItemWhere(orgId) } });
  if (owned !== ids.length) return null;
  const result = await prisma.purchaseOrder.createMany({
    data: input.lines.map((l) => ({
      skuId: l.itemId,
      orderDate: toDateOnly(input.date),
      quantity: l.quantity,
      coverageAmount: l.coverageAmount,
      leftoverQuantity: l.leftoverQuantity,
      createdById: input.createdById,
    })),
  });
  return result.count;
}

export function getStoreItem(orgId: string, itemId: string) {
  return prisma.sku.findFirst({ where: { id: itemId, ...storeItemWhere(orgId) } });
}

// ── 발주처 ────────────────────────────────────────────────────────────────────────────────────
// 같은 발주처에서 받는 품목은 도착까지 걸리는 기간이 같으므로 리드타임을 발주처에 한 번만 적는다.

export async function listSuppliers(orgId: string) {
  const rows = await prisma.supplier.findMany({
    where: { organizationId: orgId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { skus: { where: { isActive: true, warehouse: { kind: 'STORE' } } } } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, leadTimeDays: r.leadTimeDays, itemCount: r._count.skus }));
}

function rethrowSupplierName(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new SupplierNameTakenError('같은 이름의 발주처가 이미 있어요.');
  throw e;
}

type SupplierPolicyInput = { safetyDays?: number | null; targetDays?: number | null; minOrderQty?: number | null; orderMultiple?: number | null };

export async function createSupplier(orgId: string, input: { name: string; leadTimeDays: number } & SupplierPolicyInput) {
  try {
    return await prisma.supplier.create({ data: { organizationId: orgId, ...input } });
  } catch (e) {
    rethrowSupplierName(e);
  }
}

export async function updateSupplier(orgId: string, id: string, input: { name?: string; leadTimeDays?: number } & SupplierPolicyInput) {
  try {
    const result = await prisma.supplier.updateMany({ where: { id, organizationId: orgId }, data: input });
    return result.count > 0;
  } catch (e) {
    rethrowSupplierName(e);
  }
}

/** 발주처를 지우면 연결된 품목은 품목 자체의 리드타임으로 돌아간다. */
export async function deleteSupplier(orgId: string, id: string) {
  const result = await prisma.supplier.deleteMany({ where: { id, organizationId: orgId } });
  return result.count > 0;
}

export async function deletePurchaseOrder(orgId: string, id: string) {
  const result = await prisma.purchaseOrder.deleteMany({ where: { id, sku: { warehouse: { organizationId: orgId } } } });
  return result.count > 0;
}

export async function listDailySales(orgId: string, fromDate?: string): Promise<SalesEntryRow[]> {
  const rows = await prisma.dailySales.findMany({
    where: { organizationId: orgId, ...(fromDate ? { date: { gte: toDateOnly(fromDate) } } : {}) },
    orderBy: { date: 'asc' },
  });
  return rows.map((r) => ({ date: dateOnlyToString(r.date), amount: Number(r.amount) }));
}

export function upsertDailySales(orgId: string, date: string, amount: number) {
  return prisma.dailySales.upsert({
    where: { organizationId_date: { organizationId: orgId, date: toDateOnly(date) } },
    create: { organizationId: orgId, date: toDateOnly(date), amount },
    update: { amount },
  });
}

export async function deleteDailySales(orgId: string, date: string) {
  const result = await prisma.dailySales.deleteMany({ where: { organizationId: orgId, date: toDateOnly(date) } });
  return result.count > 0;
}
