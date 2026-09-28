import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';
import type { OrderEntryRow, SalesEntryRow } from '@/domain/segments/read-model';

function toDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export class StoreItemNameTakenError extends Error {}

export interface StoreItemRow {
  id: string;
  name: string;
  unit: string;
  leadTimeDays: number;
  orders: { date: string; quantity: number }[];
}

export async function listStoreItemsWithOrders(orgId: string, asOfDate?: string): Promise<StoreItemRow[]> {
  const items = await prisma.storeItem.findMany({
    where: { organizationId: orgId, isArchived: false },
    orderBy: { name: 'asc' },
    include: {
      orders: {
        where: asOfDate ? { orderDate: { lte: toDateOnly(asOfDate) } } : undefined,
        orderBy: { orderDate: 'asc' },
        select: { orderDate: true, quantity: true },
      },
    },
  });
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit,
    leadTimeDays: item.leadTimeDays,
    orders: item.orders.map((o) => ({ date: dateOnlyToString(o.orderDate), quantity: Number(o.quantity) })),
  }));
}

export async function createStoreItem(orgId: string, input: { name: string; unit: string; leadTimeDays: number }) {
  try {
    return await prisma.storeItem.create({ data: { organizationId: orgId, ...input } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new StoreItemNameTakenError('같은 이름의 품목이 이미 있어요.');
    throw e;
  }
}

export async function updateStoreItem(orgId: string, id: string, input: { name?: string; unit?: string; leadTimeDays?: number }) {
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

export async function listRecentOrders(orgId: string, limit = 40): Promise<OrderEntryRow[]> {
  const orders = await prisma.purchaseOrder.findMany({
    where: { item: { organizationId: orgId, isArchived: false } },
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
    createdByName: o.createdBy.name,
  }));
}

export async function addPurchaseOrder(orgId: string, input: { itemId: string; date: string; quantity: number; createdById: string }) {
  const item = await prisma.storeItem.findFirst({ where: { id: input.itemId, organizationId: orgId, isArchived: false }, select: { id: true } });
  if (!item) return null;
  return prisma.purchaseOrder.create({
    data: { itemId: item.id, orderDate: toDateOnly(input.date), quantity: input.quantity, createdById: input.createdById },
  });
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
