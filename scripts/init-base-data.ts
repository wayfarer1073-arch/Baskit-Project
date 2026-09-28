/**
 * 워크스페이스에 창고 A/B/C 기본 데이터 및 기본 설정값을 준비한다. 여러 번 실행해도 안전(idempotent)하다.
 * --org-id로 대상 워크스페이스를 지정하고, 없으면 가장 먼저 만들어진 워크스페이스를 쓴다.
 */
import { prisma } from '../src/lib/prisma';

async function main() {
  const orgIdArg = process.argv.includes('--org-id') ? process.argv[process.argv.indexOf('--org-id') + 1] : undefined;
  const org = orgIdArg
    ? await prisma.organization.findUniqueOrThrow({ where: { id: orgIdArg } })
    : await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) throw new Error('워크스페이스가 없습니다. 먼저 `npm run db:create-admin`을 실행하세요.');
  const warehouses = [
    { code: 'A', name: '창고 A', sortOrder: 1 },
    { code: 'B', name: '창고 B', sortOrder: 2 },
    { code: 'C', name: '창고 C', sortOrder: 3 },
  ];

  for (const w of warehouses) {
    await prisma.warehouse.upsert({
      where: { organizationId_code: { organizationId: org.id, code: w.code } },
      update: {},
      create: { ...w, organizationId: org.id },
    });
  }

  await prisma.settings.upsert({
    where: { organizationId: org.id },
    update: {},
    create: { organizationId: org.id },
  });

  console.log(`[${org.name}] 창고 A/B/C 및 기본 설정을 준비했습니다.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
