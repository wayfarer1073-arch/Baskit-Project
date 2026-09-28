/**
 * 매장 발주 예측(카페) 데모 데이터: 품목 6개, 최근 12주 발주 기록, 일 매출(최근 4주 약 15% 성장).
 * 사용법: npm run db:seed-store -- --org-id <워크스페이스 id> [--force]
 * --org-id가 없으면 가장 먼저 만들어진 워크스페이스를 쓴다. 이미 품목이 있으면 --force 없이는 건너뛴다.
 */
import { addDays, format } from 'date-fns';
import { prisma } from '../src/lib/prisma';

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

let seed = 20260928;
function rand() {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
}

const ITEMS = [
  { name: '원두 (1kg)', unit: '봉', leadTimeDays: 2, everyDays: 7, qty: 8, jitter: 1 },
  { name: '우유 (1L)', unit: '팩', leadTimeDays: 1, everyDays: 3, qty: 24, jitter: 1 },
  { name: '테이크아웃 컵 16oz', unit: '박스', leadTimeDays: 3, everyDays: 14, qty: 2, jitter: 2 },
  { name: '바닐라 시럽', unit: '병', leadTimeDays: 2, everyDays: 20, qty: 3, jitter: 3 },
  { name: '크루아상 생지', unit: '박스', leadTimeDays: 1, everyDays: 4, qty: 3, jitter: 1 },
  { name: '종이 빨대', unit: '박스', leadTimeDays: 3, everyDays: 10, qty: 1, jitter: 1, stopDaysAgo: 60 },
];

async function main() {
  const orgId = arg('org-id');
  const org = orgId
    ? await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })
    : await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) throw new Error('워크스페이스가 없습니다.');
  const user = await prisma.user.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: 'asc' } });
  if (!user) throw new Error('워크스페이스에 사용자가 없습니다.');

  const existing = await prisma.storeItem.count({ where: { organizationId: org.id } });
  if (existing > 0 && !process.argv.includes('--force')) {
    console.log(`[${org.name}] 이미 품목이 ${existing}개 있습니다. 다시 만들려면 --force를 붙이세요.`);
    return;
  }
  await prisma.storeItem.deleteMany({ where: { organizationId: org.id } });
  await prisma.dailySales.deleteMany({ where: { organizationId: org.id } });

  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const start = addDays(today, -84);

  for (const spec of ITEMS) {
    const item = await prisma.storeItem.create({
      data: { organizationId: org.id, name: spec.name, unit: spec.unit, leadTimeDays: spec.leadTimeDays },
    });
    const stop = spec.stopDaysAgo ? addDays(today, -spec.stopDaysAgo) : today;
    let day = addDays(start, Math.floor(rand() * spec.everyDays));
    const orders = [];
    while (day <= stop) {
      // 최근 4주는 매출 성장만큼 조금 더 자주 발주한 것으로 만든다.
      const recent = day > addDays(today, -28);
      orders.push({ itemId: item.id, orderDate: day, quantity: spec.qty, createdById: user.id });
      const gap = spec.everyDays * (recent ? 0.88 : 1) + Math.round((rand() - 0.5) * 2 * spec.jitter);
      day = addDays(day, Math.max(1, Math.round(gap)));
    }
    await prisma.purchaseOrder.createMany({ data: orders });
  }

  const sales = [];
  for (let d = start; d <= addDays(today, -1); d = addDays(d, 1)) {
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
    const growth = d > addDays(today, -28) ? 1.15 : 1;
    const amount = Math.round((900_000 * (weekend ? 1.3 : 1) * growth * (0.9 + rand() * 0.2)) / 100) * 100;
    if (rand() < 0.08) continue; // 가끔 입력을 빼먹은 날
    sales.push({ organizationId: org.id, date: d, amount });
  }
  await prisma.dailySales.createMany({ data: sales });
  console.log(`[${org.name}] 품목 ${ITEMS.length}개, 매출 ${sales.length}일치를 만들었습니다 (${format(start, 'yyyy-MM-dd')}~).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
