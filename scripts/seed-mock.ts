/**
 * 실제 재고 데이터와 명확히 분리된 mock 스냅샷 히스토리를 생성한다 (isMock=true).
 * 목적: 7/14/30일 이상 데이터가 쌓여야 나타나는 기능(Coverage, 예상 소진일, 소진 가속/둔화,
 * 장기 정체, 과잉재고 후보 등)을 실제 30~90일을 기다리지 않고 검증하기 위함.
 *
 * 사용법: npm run db:seed            (이미 mock 데이터가 있으면 건너뜀)
 *         npm run db:seed -- --force (기존 mock 데이터를 지우고 다시 생성)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prisma } from '../src/lib/prisma';

const DAYS = 90;
const FORCE = process.argv.includes('--force');

// --- 결정론적 PRNG (재현 가능한 mock 데이터) ---
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SampleProduct {
  code: string;
  name: string;
  location: string | null;
  barcode: string | null;
}

type Profile = 'FAST' | 'MEDIUM' | 'SLOW' | 'DEAD_STOCK' | 'ACCELERATING' | 'DECELERATING' | 'OVERSTOCK' | 'NEW_RISK';

const PROFILE_WEIGHTS: [Profile, number][] = [
  ['FAST', 0.15],
  ['MEDIUM', 0.3],
  ['SLOW', 0.15],
  ['DEAD_STOCK', 0.12],
  ['ACCELERATING', 0.1],
  ['DECELERATING', 0.08],
  ['OVERSTOCK', 0.06],
  ['NEW_RISK', 0.04],
];

function pickProfile(rand: () => number): Profile {
  const r = rand();
  let acc = 0;
  for (const [profile, weight] of PROFILE_WEIGHTS) {
    acc += weight;
    if (r <= acc) return profile;
  }
  return 'MEDIUM';
}

function kstDateString(daysAgo: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

interface DaySeries {
  date: string;
  availableStock: number;
  normalStock: number;
  defectiveStock: number;
  incomingStock: number;
  restockEvent: boolean;
}

function buildSeries(rand: () => number, profile: Profile, unitCost: number): { series: DaySeries[]; dangerQty: number; warningQty: number } {
  let initialStock: number;
  let dailyMean: number;
  let dailyVariance: number;

  // dailyVariance는 dailyMean 대비 20~25% 수준으로 유지해 순수 노이즈만으로
  // 가속(±20%) 임계값을 넘는 오탐이 나지 않게 한다. Coverage(30일 평균 소진 기준)가
  // 프로필별로 뚜렷이 구분되도록 initialStock과 dailyMean의 비율을 직접 설계한다.
  switch (profile) {
    case 'FAST': // Coverage 목표 ~12~22일
      initialStock = 250 + Math.floor(rand() * 200);
      dailyMean = 18;
      dailyVariance = 4;
      break;
    case 'MEDIUM': // Coverage 목표 ~27~45일
      initialStock = 400 + Math.floor(rand() * 300);
      dailyMean = 14;
      dailyVariance = 3;
      break;
    case 'SLOW': // Coverage 목표 ~70~110일 (일부만 과잉후보권)
      initialStock = 400 + Math.floor(rand() * 200);
      dailyMean = 5;
      dailyVariance = 1;
      break;
    case 'DEAD_STOCK':
      initialStock = 200 + Math.floor(rand() * 200);
      dailyMean = 0;
      dailyVariance = 0;
      break;
    case 'ACCELERATING': // 평소엔 정상 수준, 최근 7일만 급가속
      initialStock = 700 + Math.floor(rand() * 300);
      dailyMean = 8;
      dailyVariance = 2;
      break;
    case 'DECELERATING': // 평소엔 빠르게 소진되다가 최근 7일 급둔화
      initialStock = 1000 + Math.floor(rand() * 300);
      dailyMean = 20;
      dailyVariance = 3;
      break;
    case 'OVERSTOCK': // 확실한 과잉재고 후보 (Coverage ≫ 90일)
      initialStock = 4000 + Math.floor(rand() * 2000);
      dailyMean = 2;
      dailyVariance = 0.5;
      break;
    case 'NEW_RISK': // 평소 정상, 마지막 1~2일에 급격히 위험권 진입
      initialStock = 300 + Math.floor(rand() * 150);
      dailyMean = 5;
      dailyVariance = 1;
      break;
  }

  // 재주문점(reorder point) 기반 평균회귀 모델: 실제 창고처럼 일정 수준 이하로 내려가면
  // 어느 정도 지연 후 보충되어 대부분의 SKU가 0 근처로 영구 고갈되지 않고 정상 밴드 안에서
  // 오르내리게 한다. DEAD_STOCK/NEW_RISK는 의도적으로 이 로직을 다르게 적용한다.
  const reorderPoint = Math.round(initialStock * 0.3);
  const reorderUpToLevel = initialStock;
  const dangerQty = Math.max(5, Math.round(reorderPoint * 0.35));
  const warningQty = Math.max(dangerQty + 5, Math.round(reorderPoint * 0.8));

  const series: DaySeries[] = [];
  let available = initialStock;
  let normal = initialStock;
  let defective = Math.floor(rand() * 5);

  for (let dayIndex = 0; dayIndex < DAYS; dayIndex++) {
    const date = kstDateString(DAYS - 1 - dayIndex);
    const daysFromEnd = DAYS - 1 - dayIndex; // 0 = 오늘
    const isFinalStretch = daysFromEnd < 2;

    let mean = dailyMean;
    if (profile === 'ACCELERATING' && daysFromEnd < 7) mean = dailyMean * 2.6; // 최근 7일 급가속
    if (profile === 'DECELERATING' && daysFromEnd < 7) mean = dailyMean * 0.3; // 최근 7일 급둔화
    if (profile === 'NEW_RISK' && isFinalStretch) mean = dailyMean * 6; // 오늘 급격히 위험권 진입

    let depletion = 0;
    if (mean > 0) {
      const noise = (rand() - 0.5) * 2 * dailyVariance;
      depletion = Math.max(0, Math.round(mean + noise));
    }

    available = Math.max(0, available - depletion);
    normal = Math.max(available, normal - depletion);

    // 재주문점 이하로 내려가면 일정 확률로 보충(리드타임 지연을 흉내냄).
    // NEW_RISK는 마지막 구간에서 보충을 막아 위험권에 그대로 머물게 한다.
    let restockEvent = false;
    const allowRestock = !(profile === 'NEW_RISK' && isFinalStretch);
    if (allowRestock && available <= reorderPoint && rand() < 0.5) {
      const restockQty = reorderUpToLevel - available + Math.floor(rand() * reorderPoint * 0.3);
      available += restockQty;
      normal += restockQty;
      restockEvent = true;
    }

    if (rand() < 0.05) defective = Math.max(0, defective + (rand() < 0.5 ? 1 : -1));

    const incomingStock = rand() < 0.08 ? Math.round(50 + rand() * 200) : 0;

    series.push({ date, availableStock: available, normalStock: normal + defective, defectiveStock: defective, incomingStock, restockEvent });
  }

  return { series, dangerQty, warningQty };
}

async function main() {
  const products: SampleProduct[] = JSON.parse(readFileSync(path.join(__dirname, 'seed-data/sample-products.json'), 'utf-8'));

  const orgIdArg = process.argv.includes('--org-id') ? process.argv[process.argv.indexOf('--org-id') + 1] : undefined;
  const org = orgIdArg
    ? await prisma.organization.findUniqueOrThrow({ where: { id: orgIdArg } })
    : await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) throw new Error('워크스페이스가 없습니다. 먼저 `npm run db:create-admin`을 실행하세요.');
  const inOrg = { warehouse: { organizationId: org.id } };

  const existingMock = await prisma.inventorySnapshot.count({ where: { isMock: true, ...inOrg } });
  if (existingMock > 0 && !FORCE) {
    console.log(`이미 mock 스냅샷이 ${existingMock}건 있습니다. 다시 생성하려면 --force 옵션을 사용하세요.`);
    return;
  }
  if (existingMock > 0 && FORCE) {
    console.log('기존 mock 데이터를 삭제합니다...');
    await prisma.inventorySnapshot.deleteMany({ where: { isMock: true, ...inOrg } }); // items는 cascade
    await prisma.sku.deleteMany({ where: { items: { none: {} }, ...inOrg } });
  }

  const warehouses = await prisma.warehouse.findMany({ where: { organizationId: org.id, isArchived: false }, orderBy: { sortOrder: 'asc' } });
  if (warehouses.length === 0) {
    throw new Error('창고가 없습니다. 먼저 `npm run db:init`을 실행하세요.');
  }
  const seedUser = await prisma.user.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: 'asc' } });
  if (!seedUser) {
    throw new Error('사용자가 없습니다. 먼저 `npm run db:create-admin`을 실행하세요.');
  }

  for (const [whIndex, warehouse] of warehouses.entries()) {
    console.log(`\n[${warehouse.name}] mock 데이터 생성 중...`);
    const rand = mulberry32(1000 + whIndex * 777);

    // SKU별 시계열 생성
    const skuSeries: { product: SampleProduct; series: DaySeries[]; unitCost: number; dangerQty: number; warningQty: number }[] = [];
    for (const product of products) {
      const profile = pickProfile(rand);
      const unitCost = Math.round((500 + rand() * 30000) / 100) * 100;
      const { series, dangerQty, warningQty } = buildSeries(rand, profile, unitCost);
      skuSeries.push({ product, series, unitCost, dangerQty, warningQty });
    }

    // Sku 마스터 upsert
    const skuIdByCode = new Map<string, string>();
    for (const { product, series, unitCost, dangerQty, warningQty } of skuSeries) {
      const last = series[series.length - 1];
      const sku = await prisma.sku.upsert({
        where: { warehouseId_productCode: { warehouseId: warehouse.id, productCode: product.code } },
        update: {
          currentProductName: product.name,
          currentBarcode: product.barcode,
          currentLocation: product.location,
          currentUnitCost: unitCost,
          currentWarningQty: warningQty,
          currentDangerQty: dangerQty,
          lastSeenDate: new Date(`${last.date}T00:00:00.000Z`),
          isActive: true,
        },
        create: {
          warehouseId: warehouse.id,
          productCode: product.code,
          currentProductName: product.name,
          currentBarcode: product.barcode,
          currentLocation: product.location,
          currentUnitCost: unitCost,
          currentWarningQty: warningQty,
          currentDangerQty: dangerQty,
          firstSeenDate: new Date(`${series[0].date}T00:00:00.000Z`),
          lastSeenDate: new Date(`${last.date}T00:00:00.000Z`),
          isActive: true,
        },
      });
      skuIdByCode.set(product.code, sku.id);
      // 상품 속성은 변경 이력에 첫 날짜로 한 번만 남긴다(재고 행에는 숫자만 저장).
      await prisma.skuAttributeVersion.upsert({
        where: { skuId_effectiveDate: { skuId: sku.id, effectiveDate: new Date(`${series[0].date}T00:00:00.000Z`) } },
        update: { productName: product.name, barcode: product.barcode, location: product.location, warningQty, dangerQty },
        create: { skuId: sku.id, effectiveDate: new Date(`${series[0].date}T00:00:00.000Z`), productName: product.name, barcode: product.barcode, location: product.location, warningQty, dangerQty },
      });
    }

    // 일자별 스냅샷 + 아이템 bulk insert
    const events: { skuId: string; note: string; quantity: number; eventDate: Date }[] = [];

    for (let dayIndex = 0; dayIndex < DAYS; dayIndex++) {
      const date = skuSeries[0].series[dayIndex].date;
      const snapshot = await prisma.inventorySnapshot.create({
        data: {
          warehouseId: warehouse.id,
          snapshotDate: new Date(`${date}T00:00:00.000Z`),
          version: 1,
          status: 'ACTIVE',
          sourceFileName: `mock-seed-${warehouse.code}.xlsx`,
          fileHash: createHash('sha256').update(`${warehouse.id}-${date}`).digest('hex'),
          rowCount: skuSeries.length,
          isMock: true,
          uploadedById: seedUser.id,
          uploadedAt: new Date(`${date}T09:00:00.000Z`),
        },
      });

      const itemsData = skuSeries.map(({ product, series, unitCost }) => {
        const day = series[dayIndex];
        if (day.restockEvent) {
          events.push({ skuId: skuIdByCode.get(product.code)!, note: `${product.name} 입고 반영`, quantity: 0, eventDate: new Date(`${date}T10:00:00.000Z`) });
        }
        return {
          snapshotId: snapshot.id,
          skuId: skuIdByCode.get(product.code)!,
          unitCost,
          normalStock: day.normalStock,
          defectiveStock: day.defectiveStock,
          incomingStock: day.incomingStock,
        };
      });

      await prisma.inventoryItem.createMany({ data: itemsData });

      if (dayIndex % 15 === 0) process.stdout.write(`  ${date} 완료 (${dayIndex + 1}/${DAYS})\r`);
    }
    console.log(`  ${DAYS}일치 스냅샷 생성 완료 (SKU ${skuSeries.length}개)`);

    // restock 중 약 55%만 실제 이벤트로 기록 (나머지는 "미분류 증가"로 남겨 UI 데모)
    const classifiedEvents = events.filter(() => rand() < 0.55);
    for (const e of classifiedEvents) {
      await prisma.inventoryEvent.create({
        data: {
          warehouseId: warehouse.id,
          skuId: e.skuId,
          eventType: 'INBOUND',
          quantity: null,
          note: e.note,
          eventDate: e.eventDate,
          createdById: seedUser.id,
        },
      });
    }
    console.log(`  이벤트 ${classifiedEvents.length}건 기록 (전체 입고 감지 ${events.length}건 중)`);
  }

  console.log('\nmock 데이터 생성이 완료되었습니다. (isMock=true, 실제 데이터와 분리됨)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
