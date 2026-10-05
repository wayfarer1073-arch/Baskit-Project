import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';
import type { EasyCountItem, EasyCountLine, OrderEntryRow, SalesEntryRow, StoreItemExtras } from '@/domain/segments/read-model';

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
  expirationRiskDays: number | null;
  orders: { date: string; quantity: number; coverageAmount: number | null; leftoverQuantity: number | null; expirationDate: string | null }[];
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
    const created = await prisma.warehouse.create({ data: { organizationId: orgId, code: STORE_WAREHOUSE_CODE, name: '매장 품목', kind: 'STORE', segment: 'ORDER_CYCLE', sortOrder: 9999 } });
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
        select: { orderDate: true, quantity: true, coverageAmount: true, leftoverQuantity: true, expirationDate: true },
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
      expirationRiskDays: item.expirationRiskDays,
      orders: item.purchaseOrders.map((o) => ({
        date: dateOnlyToString(o.orderDate),
        quantity: Number(o.quantity),
        coverageAmount: num(o.coverageAmount),
        leftoverQuantity: num(o.leftoverQuantity),
        expirationDate: o.expirationDate ? dateOnlyToString(o.expirationDate) : null,
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

const extrasSelect = {
  id: true,
  currentUnitCost: true,
  currentOption: true,
  currentLocation: true,
  currentBarcode: true,
  eaPerBox: true,
  specialNote: true,
  expirationRiskDays: true,
} satisfies Prisma.SkuSelect;

function toExtras(s: Prisma.SkuGetPayload<{ select: typeof extrasSelect }>): StoreItemExtras {
  const cost = Number(s.currentUnitCost);
  return {
    itemId: s.id,
    unitCost: cost > 0 ? cost : null,
    spec: s.currentOption ?? '',
    storage: s.currentLocation ?? '',
    barcode: s.currentBarcode ?? '',
    packSize: s.eaPerBox,
    note: s.specialNote,
    expirationRiskDays: s.expirationRiskDays,
  };
}

/** 매장 품목별 원가·소비기한·참고 정보(품목 id → 정보). */
export async function listStoreItemExtras(orgId: string): Promise<Record<string, StoreItemExtras>> {
  const skus = await prisma.sku.findMany({ where: storeItemWhere(orgId), select: extrasSelect });
  return Object.fromEntries(skus.map((s) => [s.id, toExtras(s)]));
}

export async function getStoreItemExtras(orgId: string, itemId: string): Promise<StoreItemExtras | null> {
  const sku = await prisma.sku.findFirst({ where: { id: itemId, ...storeItemWhere(orgId) }, select: extrasSelect });
  return sku ? toExtras(sku) : null;
}

export interface StoreItemExtrasInput {
  unitCost: number | null;
  spec: string;
  storage: string;
  barcode: string;
  packSize: number | null;
  note: string;
  expirationRiskDays: number | null;
}

/**
 * 매장 품목의 원가·참고 정보를 저장한다. 재고 SKU와 같은 칸을 쓴다 — 규격은 옵션, 보관 방법은 위치, 입수량은 박스당 낱개 수.
 * 매장 품목은 재고 파일이 없으니 원가는 늘 직접 입력(MANUAL)이다.
 */
export async function updateStoreItemExtras(orgId: string, itemId: string, input: StoreItemExtrasInput): Promise<boolean> {
  const sku = await prisma.sku.findFirst({ where: { id: itemId, ...storeItemWhere(orgId) }, select: { id: true, currentUnitCost: true } });
  if (!sku) return false;
  const cost = input.unitCost ?? 0;
  const costChanged = Number(sku.currentUnitCost) !== cost;
  await prisma.sku.update({
    where: { id: itemId },
    data: {
      currentOption: input.spec || null,
      currentLocation: input.storage || null,
      currentBarcode: input.barcode || null,
      eaPerBox: input.packSize,
      specialNote: input.note,
      expirationRiskDays: input.expirationRiskDays,
      ...(costChanged ? { currentUnitCost: cost, unitCostSource: cost > 0 ? 'MANUAL' : null, unitCostUpdatedAt: new Date() } : {}),
    },
  });
  return true;
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
    expirationDate: o.expirationDate ? dateOnlyToString(o.expirationDate) : null,
    createdByName: o.createdBy.name,
  }));
}

export interface OrderLineInput {
  itemId: string;
  quantity: number;
  coverageAmount: number | null;
  /** 발주를 넣을 때 남아 있던 양(모르면 null). */
  leftoverQuantity: number | null;
  /** 이 발주분의 소비기한(선택). */
  expirationDate?: string | null;
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
      expirationDate: l.expirationDate ? toDateOnly(l.expirationDate) : null,
      createdById: input.createdById,
    })),
  });
  return result.count;
}

/** 이미 기록한 발주의 소비기한을 적거나 고친다(null이면 지운다). 발주일보다 앞설 수 없다. */
export async function setOrderExpiration(orgId: string, id: string, expirationDate: string | null): Promise<'ok' | 'not_found' | 'before_order'> {
  const order = await prisma.purchaseOrder.findFirst({ where: { id, sku: storeItemWhere(orgId) }, select: { orderDate: true } });
  if (!order) return 'not_found';
  if (expirationDate && expirationDate < dateOnlyToString(order.orderDate)) return 'before_order';
  await prisma.purchaseOrder.update({ where: { id }, data: { expirationDate: expirationDate ? toDateOnly(expirationDate) : null } });
  return 'ok';
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

// ── Easy Count(매장 재고 기록) ────────────────────────────────────────────────────────────────
// 한 화면에서 매장 품목 재고를 적는다 — 미개봉 완제품 개수(EA)와 개봉품 잔량(%)을 나눠 기록한다.

export async function getEasyCountSheet(orgId: string, date: string): Promise<EasyCountItem[]> {
  const day = toDateOnly(date);
  const items = await prisma.sku.findMany({
    where: storeItemWhere(orgId),
    orderBy: { currentProductName: 'asc' },
    select: {
      id: true,
      currentProductName: true,
      unit: true,
      supplier: { select: { name: true } },
      storeStockCounts: { where: { countDate: { lte: day } }, orderBy: { countDate: 'desc' }, take: 2, select: { countDate: true, fullUnits: true, openedPercent: true } },
      purchaseOrders: { where: { orderDate: { lte: day } }, orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }], take: 1, select: { orderDate: true, quantity: true } },
    },
  });
  return items.map((item) => {
    const counts = item.storeStockCounts.map((c) => ({ date: dateOnlyToString(c.countDate), fullUnits: Number(c.fullUnits), openedPercent: c.openedPercent }));
    const current = counts[0]?.date === date ? counts[0] : null;
    const previous = (current ? counts[1] : counts[0]) ?? null;
    const order = item.purchaseOrders[0];
    return {
      id: item.id,
      name: item.currentProductName,
      unit: item.unit ?? DEFAULT_UNIT,
      supplierName: item.supplier?.name ?? null,
      current: current ? { fullUnits: current.fullUnits, openedPercent: current.openedPercent } : null,
      previous,
      lastOrder: order ? { date: dateOnlyToString(order.orderDate), quantity: Number(order.quantity) } : null,
    };
  });
}

/** 한 날짜의 재고 기록을 품목 여러 개 한 번에 저장한다. 하나라도 이 조직의 품목이 아니면 아무것도 저장하지 않는다. */
export async function saveEasyCount(orgId: string, input: { date: string; lines: EasyCountLine[]; createdById: string }): Promise<{ saved: number; cleared: number } | null> {
  const ids = [...new Set(input.lines.map((l) => l.itemId))];
  const owned = await prisma.sku.count({ where: { id: { in: ids }, ...storeItemWhere(orgId) } });
  if (owned !== ids.length) return null;
  const countDate = toDateOnly(input.date);
  let saved = 0;
  let cleared = 0;
  await prisma.$transaction(async (tx) => {
    for (const line of input.lines) {
      if (line.fullUnits === null && line.openedPercent === null) {
        cleared += (await tx.storeStockCount.deleteMany({ where: { skuId: line.itemId, countDate } })).count;
        continue;
      }
      const data = { fullUnits: line.fullUnits ?? 0, openedPercent: line.openedPercent, createdById: input.createdById };
      await tx.storeStockCount.upsert({
        where: { skuId_countDate: { skuId: line.itemId, countDate } },
        create: { skuId: line.itemId, countDate, ...data },
        update: data,
      });
      saved++;
    }
  });
  return { saved, cleared };
}
