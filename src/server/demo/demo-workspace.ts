import { addDays, format } from 'date-fns';
import type { BusinessSegment, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { DEFAULT_RISK_SETTINGS } from '@/domain/inventory/types';
import { SEGMENT_META } from '@/lib/segments';

type Rand = () => number;

function makeRand(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function utcToday(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

const PRODUCT_WORDS = [
  '유기농 그래놀라',
  '콜드브루 원액',
  '단백질 바',
  '비건 쿠키',
  '저당 잼',
  '곤약 젤리',
  '현미 누룽지',
  '견과 믹스',
  '말차 라떼 파우더',
  '올리브 오일',
  '트러플 소금',
  '수제 그릭요거트',
];
const SIZES = ['200g', '500g', '1kg', '12입', '24입', '500ml', '1L'];

interface SkuPlan {
  code: string;
  name: string;
  unitCost: number;
  stock: number;
  usage: number; // 하루 평균 소진
  restockAt: number;
  restockQty: number;
}

function planSkus(rand: Rand, count: number, prefix: string): SkuPlan[] {
  return Array.from({ length: count }, (_, i) => {
    const kind = rand();
    // 빠름 / 보통 / 느림 / 정체 / 과잉을 섞어 대시보드의 여러 상태가 고르게 나오게 한다.
    const usage = kind < 0.2 ? 12 + rand() * 10 : kind < 0.55 ? 4 + rand() * 6 : kind < 0.8 ? 0.5 + rand() * 2 : kind < 0.9 ? 0 : 0.8;
    const stock = kind >= 0.9 ? 1500 + Math.floor(rand() * 1500) : Math.floor(usage * (15 + rand() * 40)) + 20;
    return {
      code: `${prefix}${String(i + 1).padStart(4, '0')}`,
      name: `${PRODUCT_WORDS[Math.floor(rand() * PRODUCT_WORDS.length)]} ${SIZES[Math.floor(rand() * SIZES.length)]}`,
      unitCost: Math.round((2000 + rand() * 28000) / 100) * 100,
      stock,
      usage,
      restockAt: Math.floor(usage * (4 + rand() * 6)),
      restockQty: Math.max(20, Math.floor(usage * (20 + rand() * 20))),
    };
  });
}

/**
 * 창고 하나에 스냅샷 시계열을 만든다. countDates에 해당하는 날짜에만 재고를 기록하고(매일 업로드 또는
 * 드문드문 실사), 그 사이에도 소진·입고는 매일 일어난다. 입고의 절반 정도만 입고 기록으로 남겨
 * "기록되지 않은 입고"도 섞는다.
 */
async function seedWarehouseSeries(
  tx: Prisma.TransactionClient,
  params: { warehouseId: string; uploaderId: string; plans: SkuPlan[]; start: Date; end: Date; countDates: Set<string>; rand: Rand; recordAllInbound: boolean },
) {
  const { warehouseId, uploaderId, plans, start, end, countDates, rand } = params;
  const dates = [...countDates].sort();
  const first = dates[0];
  const last = dates[dates.length - 1];

  await tx.sku.createMany({
    data: plans.map((p) => ({
      warehouseId,
      productCode: p.code,
      currentProductName: p.name,
      currentUnitCost: p.unitCost,
      firstSeenDate: new Date(`${first}T00:00:00.000Z`),
      lastSeenDate: new Date(`${last}T00:00:00.000Z`),
      isActive: true,
    })),
  });
  const skus = await tx.sku.findMany({ where: { warehouseId }, select: { id: true, productCode: true } });
  const skuId = new Map(skus.map((s) => [s.productCode, s.id]));

  const stock = new Map(plans.map((p) => [p.code, p.stock]));
  const inbounds: Prisma.SnapshotInboundCreateManyInput[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const day = ymd(d);
    for (const p of plans) {
      let q = stock.get(p.code)!;
      q = Math.max(0, q - Math.round(p.usage * (0.6 + rand() * 0.8)));
      if (q <= p.restockAt && p.usage > 0 && rand() < 0.5) {
        q += p.restockQty;
        if (params.recordAllInbound || rand() < 0.5) {
          inbounds.push({ skuId: skuId.get(p.code)!, snapshotDate: new Date(`${day}T00:00:00.000Z`), productCode: p.code, productName: p.name, quantity: p.restockQty });
        }
      }
      stock.set(p.code, q);
    }
    if (!countDates.has(day)) continue;
    const snapshot = await tx.inventorySnapshot.create({
      data: {
        warehouseId,
        snapshotDate: new Date(`${day}T00:00:00.000Z`),
        sourceFileName: 'demo.xlsx',
        fileHash: `demo-${warehouseId}-${day}`,
        rowCount: plans.length,
        uploadedById: uploaderId,
      },
    });
    await tx.inventoryItem.createMany({
      data: plans.map((p) => ({
        snapshotId: snapshot.id,
        skuId: skuId.get(p.code)!,
        unitCost: p.unitCost,
        normalStock: stock.get(p.code)!,
      })),
    });
  }
  // 입고는 (SKU, 날짜) 단위로 하나만 둘 수 있다.
  const merged = new Map<string, Prisma.SnapshotInboundCreateManyInput>();
  for (const e of inbounds) {
    const key = `${e.skuId}|${ymd(e.snapshotDate as Date)}`;
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, quantity: prev.quantity + e.quantity } : e);
  }
  if (merged.size) await tx.snapshotInbound.createMany({ data: [...merged.values()] });
}

async function seedDaily(tx: Prisma.TransactionClient, orgId: string, uploaderId: string, rand: Rand) {
  // 일일 대시보드는 오늘 자료가 올라와 있어야 "최신"으로 보므로 오늘(평일이면)까지 채운다.
  const end = utcToday();
  const start = addDays(end, -44);
  const countDates = new Set<string>();
  for (let d = start; d <= end; d = addDays(d, 1)) if (!isWeekend(d)) countDates.add(ymd(d));
  for (const [i, name] of ['서울 3PL센터', '부산 3PL센터'].entries()) {
    const wh = await tx.warehouse.create({ data: { organizationId: orgId, code: `D${String.fromCharCode(65 + i)}`, name, sortOrder: i + 1 } });
    await seedWarehouseSeries(tx, { warehouseId: wh.id, uploaderId, plans: planSkus(rand, 30, `D${i}`), start, end, countDates, rand, recordAllInbound: false });
  }
}

async function seedPeriodic(tx: Prisma.TransactionClient, orgId: string, uploaderId: string, rand: Rand) {
  const end = utcToday();
  const start = addDays(end, -90);
  const countDates = new Set<string>();
  // 7~12일 간격으로 실사, 마지막 실사는 며칠 전.
  for (let d = addDays(start, 2); d <= addDays(end, -4); d = addDays(d, 7 + Math.floor(rand() * 6))) countDates.add(ymd(d));
  const wh = await tx.warehouse.create({ data: { organizationId: orgId, code: 'PA', name: '본사 창고', sortOrder: 1, segment: 'PERIODIC_COUNT' } });
  await seedWarehouseSeries(tx, { warehouseId: wh.id, uploaderId, plans: planSkus(rand, 35, 'P'), start, end: addDays(end, -1), countDates, rand, recordAllInbound: true });
}

const STORE_SUPPLIERS = [
  { key: 'bean', name: '로스터리 원두상사', leadTimeDays: 2 },
  { key: 'dairy', name: '동네 유업', leadTimeDays: 1 },
  { key: 'pack', name: '포장재몰', leadTimeDays: 3 },
] as const;

const STORE_ITEMS: {
  name: string;
  unit: string;
  leadTimeDays: number;
  everyDays: number;
  qty: number;
  supplier?: (typeof STORE_SUPPLIERS)[number]['key'];
  stopDaysAgo?: number;
  /** 소비기한을 관리하는 품목 — 발주일로부터 이 일수 뒤를 소비기한으로 적는다. */
  shelfLifeDays?: number;
}[] = [
  { name: '원두 (1kg)', unit: '봉', leadTimeDays: 2, everyDays: 7, qty: 8, supplier: 'bean' },
  { name: '우유 (1L)', unit: '팩', leadTimeDays: 1, everyDays: 3, qty: 24, supplier: 'dairy', shelfLifeDays: 5 },
  { name: '테이크아웃 컵 16oz', unit: '박스', leadTimeDays: 3, everyDays: 14, qty: 2, supplier: 'pack' },
  { name: '바닐라 시럽', unit: '병', leadTimeDays: 2, everyDays: 20, qty: 3 },
  { name: '크루아상 생지', unit: '박스', leadTimeDays: 1, everyDays: 4, qty: 3, shelfLifeDays: 30 },
  { name: '종이 빨대', unit: '박스', leadTimeDays: 3, everyDays: 10, qty: 1, supplier: 'pack', stopDaysAgo: 60 },
];

const BASE_DAILY_SALES = 900_000;

/**
 * 카페 데모: 발주처 3곳, 품목 6개, 최근 12주 일 매출(최근 4주 약 15% 성장)과 그에 맞춘 발주 기록.
 * 실제 매출로 재고가 줄어드는 것을 하루씩 따라가며, 잔량이 조금 남았을 때 재발주한다. 사장님은 충족 매출을
 * 실제보다 15% 정도 보수적으로 적는 습관이 있어, 학습값이 입력값보다 크게 나오는 모습을 볼 수 있다.
 */
export async function seedStoreData(tx: Prisma.TransactionClient, orgId: string, uploaderId: string, rand: Rand) {
  const today = utcToday();
  const start = addDays(today, -84);

  const days: { date: Date; amount: number; recorded: boolean }[] = [];
  for (let d = start; d <= addDays(today, -1); d = addDays(d, 1)) {
    const growth = d > addDays(today, -28) ? 1.15 : 1;
    const amount = Math.round((BASE_DAILY_SALES * (isWeekend(d) ? 1.3 : 1) * growth * (0.9 + rand() * 0.2)) / 100) * 100;
    days.push({ date: d, amount, recorded: rand() >= 0.08 }); // 가끔 입력을 빼먹은 날
  }
  await tx.dailySales.createMany({ data: days.filter((d) => d.recorded).map((d) => ({ organizationId: orgId, date: d.date, amount: d.amount })) });

  const supplierIds = new Map<string, string>();
  for (const sup of STORE_SUPPLIERS) {
    const row = await tx.supplier.create({ data: { organizationId: orgId, name: sup.name, leadTimeDays: sup.leadTimeDays } });
    supplierIds.set(sup.key, row.id);
  }

  // 매장 품목은 '매장 품목' 가상 창고의 SKU다.
  const storeWarehouse = await tx.warehouse.create({ data: { organizationId: orgId, code: 'STORE', name: '매장 품목', kind: 'STORE', segment: 'ORDER_CYCLE', sortOrder: 9999 } });
  for (const [index, spec] of STORE_ITEMS.entries()) {
    const item = await tx.sku.create({
      data: {
        warehouseId: storeWarehouse.id,
        productCode: `S${String(index + 1).padStart(4, '0')}`,
        currentProductName: spec.name,
        unit: spec.unit,
        reorderLeadTimeDays: spec.leadTimeDays,
        supplierId: spec.supplier ? supplierIds.get(spec.supplier) : null,
        firstSeenDate: days[0].date,
        lastSeenDate: today,
      },
    });
    // 이 품목 1단위가 실제로 감당하는 매출 — 평소 발주 간격만큼 팔면 발주량을 다 쓰도록 맞춘다.
    const salesPerUnit = (BASE_DAILY_SALES * 1.09 * spec.everyDays) / spec.qty;
    const stop = spec.stopDaysAgo ? addDays(today, -spec.stopDaysAgo) : today;
    const orders: Prisma.PurchaseOrderCreateManyInput[] = [];
    let stock = 0;
    let reorderAt = 0;
    const firstDay = Math.floor(rand() * spec.everyDays);
    for (let i = firstDay; i < days.length; i++) {
      const day = days[i];
      if (day.date > stop) break;
      if (i === firstDay || stock <= reorderAt) {
        const leftover = Math.max(0, Math.round(stock * 4) / 4);
        orders.push({
          skuId: item.id,
          orderDate: day.date,
          quantity: spec.qty,
          coverageAmount: Math.round((spec.qty * salesPerUnit * 0.85) / 10_000) * 10_000,
          leftoverQuantity: i === firstDay ? null : rand() < 0.75 ? leftover : null,
          expirationDate: spec.shelfLifeDays ? addDays(day.date, spec.shelfLifeDays) : null,
          createdById: uploaderId,
        });
        stock = Math.max(0, stock) + spec.qty;
        reorderAt = spec.qty * (0.05 + rand() * 0.12);
      }
      stock -= day.amount / salesPerUnit;
    }
    await tx.purchaseOrder.createMany({ data: orders });
  }
}

export { makeRand };

/** 운영자 콘솔용: 선택한 관리 방식의 샘플 데이터가 들어 있는 워크스페이스를 만든다. 사용자는 없고 운영자가 "들어가서" 본다. */
export async function createDemoWorkspace(segment: BusinessSegment, actorId: string) {
  const rand = makeRand(Date.now());
  const name = `데모 · ${SEGMENT_META[segment].label} · ${format(new Date(), 'MM-dd HH:mm')}`;
  return prisma.$transaction(
    async (tx) => {
      const org = await tx.organization.create({ data: { name, segment, isDemo: true } });
      await tx.settings.create({ data: { organizationId: org.id, ...DEFAULT_RISK_SETTINGS } });
      if (segment === 'DAILY_SYNC') await seedDaily(tx, org.id, actorId, rand);
      else if (segment === 'PERIODIC_COUNT') await seedPeriodic(tx, org.id, actorId, rand);
      else {
        await tx.warehouse.create({ data: { organizationId: org.id, code: 'DA', name: '기본 창고', sortOrder: 1 } });
        await seedStoreData(tx, org.id, actorId, rand);
      }
      return org;
    },
    { timeout: 120_000, maxWait: 15_000 },
  );
}
