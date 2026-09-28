import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { addDays, format } from 'date-fns';
import type { BusinessSegment, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';
import type { AuditLogRow, PlatformMetrics, WorkspaceSummary, WorkspaceUserRow, WorkspaceWarehouseRow } from '@/domain/platform/read-model';

type OrgAgg = { org: string; n: number; last: Date | null };

async function aggregateByOrg(): Promise<{
  skus: Map<string, number>;
  snapshots: Map<string, OrgAgg>;
  orders: Map<string, OrgAgg>;
  sales: Map<string, Date>;
  events: Map<string, Date>;
  logins: Map<string, Date>;
}> {
  const [skus, snapshots, orders, sales, events, logins] = await Promise.all([
    prisma.$queryRaw<{ org: string; n: number }[]>`
      SELECT w."organizationId" AS org, COUNT(*)::int AS n FROM skus s JOIN warehouses w ON w.id = s."warehouseId" GROUP BY 1`,
    prisma.$queryRaw<OrgAgg[]>`
      SELECT w."organizationId" AS org, COUNT(*)::int AS n, MAX(s."uploadedAt") AS last
      FROM inventory_snapshots s JOIN warehouses w ON w.id = s."warehouseId" WHERE s.status = 'ACTIVE' GROUP BY 1`,
    prisma.$queryRaw<OrgAgg[]>`
      SELECT i."organizationId" AS org, COUNT(*)::int AS n, MAX(o."createdAt") AS last
      FROM purchase_orders o JOIN store_items i ON i.id = o."itemId" GROUP BY 1`,
    prisma.$queryRaw<{ org: string; last: Date }[]>`SELECT "organizationId" AS org, MAX("updatedAt") AS last FROM daily_sales GROUP BY 1`,
    prisma.$queryRaw<{ org: string; last: Date }[]>`
      SELECT w."organizationId" AS org, MAX(e."createdAt") AS last FROM inventory_events e JOIN warehouses w ON w.id = e."warehouseId" GROUP BY 1`,
    prisma.$queryRaw<{ org: string; last: Date }[]>`SELECT "organizationId" AS org, MAX("lastLoginAt") AS last FROM users GROUP BY 1`,
  ]);
  return {
    skus: new Map(skus.map((r) => [r.org, r.n])),
    snapshots: new Map(snapshots.map((r) => [r.org, r])),
    orders: new Map(orders.map((r) => [r.org, r])),
    sales: new Map(sales.map((r) => [r.org, r.last])),
    events: new Map(events.map((r) => [r.org, r.last])),
    logins: new Map(logins.filter((r) => r.last).map((r) => [r.org, r.last])),
  };
}

function latest(...dates: (Date | null | undefined)[]): Date | null {
  const valid = dates.filter((d): d is Date => d instanceof Date);
  return valid.length ? new Date(Math.max(...valid.map((d) => d.getTime()))) : null;
}

export async function listWorkspaceSummaries(): Promise<WorkspaceSummary[]> {
  const [orgs, agg] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true, storeItems: true, dailySales: true, warehouses: { where: { isArchived: false } } } },
        users: { where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, take: 1, select: { email: true, name: true } },
      },
    }),
    aggregateByOrg(),
  ]);
  const platformAdminOrgs = new Set(
    (await prisma.user.findMany({ where: { isPlatformAdmin: true }, select: { organizationId: true } })).map((u) => u.organizationId),
  );
  return orgs.map((o) => {
    const snap = agg.snapshots.get(o.id);
    const orders = agg.orders.get(o.id);
    const login = agg.logins.get(o.id) ?? null;
    const lastActivity = latest(snap?.last, orders?.last, agg.sales.get(o.id), agg.events.get(o.id), login);
    return {
      id: o.id,
      name: o.name,
      segment: o.segment,
      isDemo: o.isDemo,
      suspendedAt: o.suspendedAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
      ownerEmail: o.users[0]?.email ?? null,
      ownerName: o.users[0]?.name ?? null,
      userCount: o._count.users,
      warehouseCount: o._count.warehouses,
      skuCount: agg.skus.get(o.id) ?? 0,
      snapshotCount: snap?.n ?? 0,
      storeItemCount: o._count.storeItems,
      orderCount: orders?.n ?? 0,
      salesDays: o._count.dailySales,
      lastActivityAt: lastActivity?.toISOString() ?? null,
      lastLoginAt: login?.toISOString() ?? null,
      hasPlatformAdmin: platformAdminOrgs.has(o.id),
    };
  });
}

/** 가입 통계는 운영자가 만든 데모 워크스페이스를 빼고 센다. */
export function computePlatformMetrics(workspaces: WorkspaceSummary[], now = new Date()): PlatformMetrics {
  const real = workspaces.filter((w) => !w.isDemo);
  const since = (days: number) => addDays(now, -days).toISOString();
  const bySegment: Record<BusinessSegment, number> = { DAILY_SYNC: 0, PERIODIC_COUNT: 0, ORDER_CYCLE: 0 };
  for (const w of real) bySegment[w.segment] += 1;
  const signupsByDay = Array.from({ length: 30 }, (_, i) => {
    const date = format(addDays(now, i - 29), 'yyyy-MM-dd');
    return { date, count: real.filter((w) => w.createdAt.slice(0, 10) === date).length };
  });
  return {
    workspaceCount: real.length,
    userCount: real.reduce((s, w) => s + w.userCount, 0),
    signups7d: real.filter((w) => w.createdAt >= since(7)).length,
    signups30d: real.filter((w) => w.createdAt >= since(30)).length,
    active7d: real.filter((w) => w.lastActivityAt && w.lastActivityAt >= since(7)).length,
    suspendedCount: real.filter((w) => w.suspendedAt).length,
    demoCount: workspaces.length - real.length,
    bySegment,
    signupsByDay,
  };
}

export async function getWorkspaceDetail(orgId: string) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return null;
  const [users, warehouses, skuCounts, lastSnapshots, summary] = await Promise.all([
    prisma.user.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'asc' } }),
    prisma.warehouse.findMany({ where: { organizationId: orgId }, orderBy: { sortOrder: 'asc' } }),
    prisma.sku.groupBy({ by: ['warehouseId'], where: { warehouse: { organizationId: orgId } }, _count: { _all: true } }),
    prisma.inventorySnapshot.groupBy({ by: ['warehouseId'], where: { warehouse: { organizationId: orgId }, status: 'ACTIVE' }, _max: { snapshotDate: true } }),
    listWorkspaceSummaries().then((all) => all.find((w) => w.id === orgId) ?? null),
  ]);
  const skuByWh = new Map(skuCounts.map((r) => [r.warehouseId, r._count._all]));
  const lastByWh = new Map(lastSnapshots.map((r) => [r.warehouseId, r._max.snapshotDate]));
  return {
    summary: summary!,
    users: users.map<WorkspaceUserRow>((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      isPlatformAdmin: u.isPlatformAdmin,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    })),
    warehouses: warehouses.map<WorkspaceWarehouseRow>((w) => {
      const last = lastByWh.get(w.id);
      return { id: w.id, code: w.code, name: w.name, isArchived: w.isArchived, skuCount: skuByWh.get(w.id) ?? 0, lastSnapshotDate: last ? dateOnlyToString(last) : null };
    }),
  };
}

export async function setWorkspaceSuspended(orgId: string, suspended: boolean) {
  const result = await prisma.organization.updateMany({ where: { id: orgId }, data: { suspendedAt: suspended ? new Date() : null } });
  return result.count > 0;
}

export async function updateWorkspace(orgId: string, data: { name?: string; segment?: BusinessSegment }) {
  const result = await prisma.organization.updateMany({ where: { id: orgId }, data });
  return result.count > 0;
}

/**
 * 워크스페이스와 그 안의 모든 데이터를 지운다. 되돌릴 수 없으므로 API에서 이름 재입력 확인과
 * "운영자가 속한 워크스페이스는 삭제 불가" 규칙을 먼저 통과해야 한다. 외래키 순서대로 자식부터 지운다.
 */
export async function deleteWorkspace(orgId: string) {
  const inOrgWarehouse = { warehouse: { organizationId: orgId } };
  await prisma.$transaction(
    async (tx) => {
      await tx.snapshotInbound.deleteMany({ where: { sku: inOrgWarehouse } });
      await tx.inventoryEvent.deleteMany({ where: inOrgWarehouse }); // 이력(EventHistory)은 DB cascade
      await tx.eventSchedule.deleteMany({ where: { organizationId: orgId } });
      await tx.inventorySnapshot.deleteMany({ where: inOrgWarehouse }); // 스냅샷 품목은 DB cascade
      await tx.skuPackagingUpload.deleteMany({ where: inOrgWarehouse });
      await tx.sku.deleteMany({ where: inOrgWarehouse }); // 소비기한 로트·즐겨찾기는 DB cascade
      await tx.warehouse.deleteMany({ where: { organizationId: orgId } });
      await tx.storeItem.deleteMany({ where: { organizationId: orgId } }); // 발주 기록은 DB cascade
      await tx.supplier.deleteMany({ where: { organizationId: orgId } });
      await tx.dailySales.deleteMany({ where: { organizationId: orgId } });
      await tx.post.deleteMany({ where: { organizationId: orgId } });
      await tx.holiday.deleteMany({ where: { organizationId: orgId } });
      await tx.settings.deleteMany({ where: { organizationId: orgId } });
      await tx.user.deleteMany({ where: { organizationId: orgId } });
      await tx.organization.delete({ where: { id: orgId } });
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
}

export function getUserForAdmin(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isPlatformAdmin: true, organizationId: true, organization: { select: { name: true } } } });
}

export async function setUserActive(userId: string, isActive: boolean) {
  await prisma.user.update({ where: { id: userId }, data: { isActive } });
}

/** 12자리 임시 비밀번호를 발급해 즉시 적용한다. 평문은 이 응답에서 한 번만 보여주고 저장하지 않는다. */
export async function resetUserPassword(userId: string): Promise<string> {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  const password = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(password, 10), isActive: true } });
  return password;
}

export async function recordAudit(actorId: string, action: string, org?: { id: string; name: string } | null, detail?: Prisma.InputJsonValue) {
  await prisma.platformAuditLog.create({
    data: { actorId, action, organizationId: org?.id ?? null, organizationName: org?.name ?? null, detail: detail ?? undefined },
  });
}

export async function listAuditLogs(limit = 30, orgId?: string): Promise<AuditLogRow[]> {
  const rows = await prisma.platformAuditLog.findMany({
    where: orgId ? { organizationId: orgId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { actor: { select: { email: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    actorEmail: r.actor.email,
    action: r.action,
    organizationId: r.organizationId,
    organizationName: r.organizationName,
    detail: r.detail,
    createdAt: r.createdAt.toISOString(),
  }));
}
