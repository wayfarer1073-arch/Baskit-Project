/**
 * 매장 발주 예측(카페) 데모 데이터: 품목 6개, 최근 12주 발주 기록, 일 매출(최근 4주 약 15% 성장).
 * 사용법: npm run db:seed-store -- --org-id <워크스페이스 id> [--force]
 * --org-id가 없으면 가장 먼저 만들어진 워크스페이스를 쓴다. 이미 품목이 있으면 --force 없이는 건너뛴다.
 * (운영자 콘솔의 "데모 워크스페이스 만들기"도 같은 생성 로직을 쓴다.)
 */
import { prisma } from '../src/lib/prisma';
import { makeRand, seedStoreData } from '../src/server/demo/demo-workspace';

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

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
  await prisma.$transaction((tx) => seedStoreData(tx, org.id, user.id, makeRand(20260928)), { timeout: 120_000 });
  console.log(`[${org.name}] 카페 데모 품목·발주·매출 데이터를 만들었습니다.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
