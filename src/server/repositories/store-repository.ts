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

export async function listStoreItemsWithOrders(orgId: string, asOfDate?: string): Promise<StoreItemRow[]> {
  const items = await prisma.storeItem.findMany({
    where: { organizationId: orgId, isArchived: false },
    orderBy: { name: 'asc' },
    include: {
      orders: {
        where: asOfDate ? { orderDate: { lte: toDateOnly(asOfDate) } } : undefined,
        orderBy: { orderDate: 'asc' },
        select: { orderDate: true, quantity: true, coverageAmount: true, leftoverQuantity: true },
      },
      supplier: { select: { id: true, name: true, leadTimeDays: true } },
    },
  });
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit,
    leadTimeDays: item.supplier?.leadTimeDays ?? item.leadTimeDays,
    itemLeadTimeDays: item.leadTimeDays,
    supplierId: item.supplier?.id ?? null,
    supplierName: item.supplier?.name ?? null,
    orders: item.orders.map((o) => ({
      date: dateOnlyToString(o.orderDate),
      quantity: Number(o.quantity),
      coverageAmount: num(o.coverageAmount),
      leftoverQuantity: num(o.leftoverQuantity),
    })),
  }));
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

export async function createStoreItem(orgId: string, input: StoreItemInput) {
  if (!(await supplierBelongs(orgId, input.supplierId))) return null;
  try {
    return await prisma.storeItem.create({ data: { organizationId: orgId, ...input } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new StoreItemNameTakenError('같은 이름의 품목이 이미 있어요.');
    throw e;
  }
}

export async function updateStoreItem(orgId: string, id: string, input: Partial<StoreItemInput>) {
  if (!(await supplierBelongs(orgId, input.supplierId))) return false;
  try {
    const result = await prisma.storeItem.updateMany({ where: { id, organizationId: orgId, isArchived: false }, data: input });
    return result.count > 0;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new StoreItemNameTakenError('같은 이름의 품목이 이미 있어요.');
    throw e;
  }
}

/** 발주 기록이 예측의 근거라 품목은 지우지 않고 보관한다. 같은 이름으로 다시 만들 수 있도록 이름 뒤에 표시를 붙인다. */
export async function archiveStoreItem(orgId: string, id: string) {
  const item = await prisma.storeItem.findFirst({ where: { id, organizationId: orgId, isArchived: false } });
  if (!item) return false;
  await prisma.storeItem.update({ where: { id }, data: { isArchived: true, name: `${item.name} (보관 ${item.id.slice(-6)})` } });
  return true;
}

export async function listRecentOrders(orgId: string, limit = 40, itemId?: string): Promise<OrderEntryRow[]> {
  const orders = await prisma.purchaseOrder.findMany({
    where: { item: { organizationId: orgId, isArchived: false }, ...(itemId ? { itemId } : {}) },
    orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: { item: { select: { name: true, unit: true } }, createdBy: { select: { name: true } } },
  });
  return orders.map((o) => ({
    id: o.id,
    itemId: o.itemId,
    itemName: o.item.name,
    unit: o.item.unit,
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
  const owned = await prisma.storeItem.count({ where: { id: { in: ids }, organizationId: orgId, isArchived: false } });
  if (owned !== ids.length) return null;
  const result = await prisma.purchaseOrder.createMany({
    data: input.lines.map((l) => ({
      itemId: l.itemId,
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
  return prisma.storeItem.findFirst({ where: { id: itemId, organizationId: orgId, isArchived: false } });
}

// ── 발주처 ────────────────────────────────────────────────────────────────────────────────────
// 같은 발주처에서 받는 품목은 도착까지 걸리는 기간이 같으므로 리드타임을 발주처에 한 번만 적는다.

export async function listSuppliers(orgId: string) {
  const rows = await prisma.supplier.findMany({
    where: { organizationId: orgId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { items: { where: { isArchived: false } } } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, leadTimeDays: r.leadTimeDays, itemCount: r._count.items }));
}

function rethrowSupplierName(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new SupplierNameTakenError('같은 이름의 발주처가 이미 있어요.');
  throw e;
}

export async function createSupplier(orgId: string, input: { name: string; leadTimeDays: number }) {
  try {
    return await prisma.supplier.create({ data: { organizationId: orgId, ...input } });
  } catch (e) {
    rethrowSupplierName(e);
  }
}

export async function updateSupplier(orgId: string, id: string, input: { name?: string; leadTimeDays?: number }) {
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
  const result = await prisma.purchaseOrder.deleteMany({ where: { id, item: { organizationId: orgId } } });
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
