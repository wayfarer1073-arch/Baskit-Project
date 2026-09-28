import { prisma } from '@/lib/prisma';

/** 조직의 사용 중인 창고 목록. 보관(isArchived)된 창고는 화면·계산 어디에도 나오지 않는다. */
export function listWarehouses(orgId: string) {
  return prisma.warehouse.findMany({ where: { organizationId: orgId, isArchived: false }, orderBy: { sortOrder: 'asc' } });
}

/** 요청으로 들어온 창고 id가 이 조직의 사용 중인 창고인지 확인한다. 아니면 null. */
export function getWarehouseInOrg(orgId: string, id: string) {
  return prisma.warehouse.findFirst({ where: { id, organizationId: orgId, isArchived: false } });
}

/** A, B, …, Z, AA, AB … (엑셀 열 이름 방식) — 조직 안에서 아직 안 쓴 첫 코드. 보관된 창고의 코드도 재사용하지 않는다. */
export function nextWarehouseCode(usedCodes: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    let num = n;
    let code = '';
    while (num > 0) {
      num -= 1;
      code = String.fromCharCode(65 + (num % 26)) + code;
      num = Math.floor(num / 26);
    }
    if (!usedCodes.has(code)) return code;
  }
}

export async function createWarehouse(orgId: string, name: string) {
  return prisma.$transaction(async (tx) => {
    // 같은 조직에서 동시에 창고를 추가해도 코드가 겹치지 않도록 조직 행을 잠근다.
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${orgId} FOR UPDATE`;
    const existing = await tx.warehouse.findMany({ where: { organizationId: orgId }, select: { code: true, sortOrder: true } });
    const code = nextWarehouseCode(new Set(existing.map((w) => w.code)));
    const sortOrder = existing.reduce((max, w) => Math.max(max, w.sortOrder), 0) + 1;
    return tx.warehouse.create({ data: { organizationId: orgId, code, name, sortOrder } });
  });
}

export async function renameWarehouse(orgId: string, id: string, name: string) {
  const result = await prisma.warehouse.updateMany({ where: { id, organizationId: orgId, isArchived: false }, data: { name } });
  return result.count > 0;
}

export async function archiveWarehouse(orgId: string, id: string) {
  const result = await prisma.warehouse.updateMany({ where: { id, organizationId: orgId, isArchived: false }, data: { isArchived: true } });
  return result.count > 0;
}
