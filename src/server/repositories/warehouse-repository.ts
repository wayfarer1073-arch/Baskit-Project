import { prisma } from '@/lib/prisma';

/** 실제 창고를 쓰는 관리 방식 — 일일 재고 연동과 비정기 실사는 창고를 따로 둔다. */
export type StockSegment = 'DAILY_SYNC' | 'PERIODIC_COUNT';

export const isStockSegment = (value: unknown): value is StockSegment => value === 'DAILY_SYNC' || value === 'PERIODIC_COUNT';

/** 조직의 사용 중인 창고 목록. 보관(isArchived)된 창고와 매장 품목용 가상 창고(kind STORE)는 화면·계산 어디에도 나오지 않는다. */
export function listWarehouses(orgId: string, segment?: StockSegment) {
  return prisma.warehouse.findMany({ where: { organizationId: orgId, isArchived: false, kind: 'STOCK', ...(segment ? { segment } : {}) }, orderBy: { sortOrder: 'asc' } });
}

/**
 * 요청으로 들어온 창고 id가 이 조직의 사용 중인 창고인지 확인한다. 아니면 null.
 * 매장 품목 가상 창고는 메모/이벤트처럼 두 쪽이 함께 쓰는 기능에서만 includeStore로 허용한다.
 */
export function getWarehouseInOrg(orgId: string, id: string, options: { includeStore?: boolean; segment?: StockSegment } = {}) {
  return prisma.warehouse.findFirst({
    where: { id, organizationId: orgId, isArchived: false, ...(options.includeStore ? {} : { kind: 'STOCK' as const }), ...(options.segment ? { segment: options.segment } : {}) },
  });
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

export async function createWarehouse(orgId: string, name: string, segment: StockSegment = 'DAILY_SYNC') {
  return prisma.$transaction(async (tx) => {
    // 같은 조직에서 동시에 창고를 추가해도 코드가 겹치지 않도록 조직 행을 잠근다.
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${orgId} FOR UPDATE`;
    const existing = await tx.warehouse.findMany({ where: { organizationId: orgId }, select: { code: true, sortOrder: true, kind: true } });
    const code = nextWarehouseCode(new Set(existing.map((w) => w.code)));
    const sortOrder = existing.reduce((max, w) => (w.kind === 'STOCK' ? Math.max(max, w.sortOrder) : max), 0) + 1;
    return tx.warehouse.create({ data: { organizationId: orgId, code, name, sortOrder, segment } });
  });
}

export async function renameWarehouse(orgId: string, id: string, name: string) {
  const result = await prisma.warehouse.updateMany({ where: { id, organizationId: orgId, isArchived: false, kind: 'STOCK' }, data: { name } });
  return result.count > 0;
}

export async function archiveWarehouse(orgId: string, id: string) {
  const result = await prisma.warehouse.updateMany({ where: { id, organizationId: orgId, isArchived: false, kind: 'STOCK' }, data: { isArchived: true } });
  return result.count > 0;
}

/**
 * 켜 둔 방식에 창고가 하나도 없으면 기본 창고를 하나 만든다 — 일일 재고 연동으로 가입한 뒤 비정기 실사를 켰을 때처럼,
 * 그 방식의 업로드·입력 화면이 창고 없이 비지 않도록. 이미 있으면 아무것도 하지 않는다.
 */
export async function ensureSegmentWarehouse(orgId: string, segment: StockSegment, name: string) {
  const count = await prisma.warehouse.count({ where: { organizationId: orgId, kind: 'STOCK', isArchived: false, segment } });
  if (count === 0) await createWarehouse(orgId, name, segment);
}
