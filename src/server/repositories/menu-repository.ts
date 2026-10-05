import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';
import { headerFingerprint } from '@/domain/excel/layout';
import { MENU_SALES_FIELDS, type MenuSalesLayout } from '@/domain/excel/menu-sales-fields';
import type { MenuMatch, RecipeItemRow, StoreMenuRow } from '@/domain/segments/read-model';

/**
 * 매장 메뉴·레시피·메뉴별 판매.
 * 메뉴 판매 파일의 메뉴 이름은 상품코드 → 메뉴 이름 → 저장한 이름 연결(alias) 순서로 메뉴에 맞추고,
 * 처음 보는 이름은 사용자가 고른 대로(기존 메뉴 / 새 메뉴 / 무시) 기억해 다음 업로드부터 자동으로 처리한다.
 */

const toDateOnly = (date: string) => new Date(`${date}T00:00:00.000Z`);
const num = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
const storeItemWhere = (orgId: string) => ({ isActive: true, warehouse: { organizationId: orgId, kind: 'STORE' as const } });
const RECENT_DAYS = 7;

export class MenuNameTakenError extends Error {}

// ── 품목(레시피 재료) ─────────────────────────────────────────────────────────────────────────

export async function listRecipeItems(orgId: string): Promise<RecipeItemRow[]> {
  const items = await prisma.sku.findMany({
    where: storeItemWhere(orgId),
    orderBy: { currentProductName: 'asc' },
    select: { id: true, currentProductName: true, unit: true, storeContentPerUnit: true, storeContentUnit: true },
  });
  return items.map((i) => ({
    id: i.id,
    name: i.currentProductName,
    unit: i.unit ?? '개',
    contentPerUnit: num(i.storeContentPerUnit),
    contentUnit: i.storeContentPerUnit ? (i.storeContentUnit ?? null) : null,
  }));
}

/** 품목 환산(1봉 = 1000 g)을 적거나 지운다(contentPerUnit null). */
export async function setItemContent(orgId: string, itemId: string, input: { contentPerUnit: number | null; contentUnit: string | null }): Promise<boolean> {
  const result = await prisma.sku.updateMany({
    where: { id: itemId, ...storeItemWhere(orgId) },
    data: { storeContentPerUnit: input.contentPerUnit, storeContentUnit: input.contentPerUnit ? input.contentUnit : null },
  });
  return result.count > 0;
}

// ── 메뉴·레시피 ───────────────────────────────────────────────────────────────────────────────

export async function listMenus(orgId: string, asOfDate: string): Promise<StoreMenuRow[]> {
  const from = new Date(toDateOnly(asOfDate).getTime() - (RECENT_DAYS - 1) * 86_400_000);
  const menus = await prisma.storeMenu.findMany({
    where: { organizationId: orgId, isActive: true },
    orderBy: { name: 'asc' },
    include: {
      recipeLines: { where: { sku: storeItemWhere(orgId) }, select: { skuId: true, quantity: true } },
      sales: { where: { date: { gte: from, lte: toDateOnly(asOfDate) } }, select: { quantity: true } },
    },
  });
  return menus.map((m) => ({
    id: m.id,
    name: m.name,
    code: m.code,
    lines: m.recipeLines.map((l) => ({ itemId: l.skuId, quantity: Number(l.quantity) })),
    soldRecent: m.sales.reduce((s, x) => s + Number(x.quantity), 0),
  }));
}

export async function createMenu(orgId: string, input: { name: string; code?: string | null }) {
  try {
    return await prisma.storeMenu.create({ data: { organizationId: orgId, name: input.name, code: input.code || null } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // 보관해 둔 같은 이름 메뉴가 있으면 다시 꺼낸다.
      const archived = await prisma.storeMenu.findFirst({ where: { organizationId: orgId, name: input.name, isActive: false } });
      if (archived) return prisma.storeMenu.update({ where: { id: archived.id }, data: { isActive: true, code: input.code || archived.code } });
      throw new MenuNameTakenError();
    }
    throw e;
  }
}

export async function updateMenu(orgId: string, id: string, input: { name?: string; code?: string | null }): Promise<boolean> {
  try {
    const result = await prisma.storeMenu.updateMany({
      where: { id, organizationId: orgId },
      data: { ...(input.name ? { name: input.name } : {}), ...(input.code !== undefined ? { code: input.code || null } : {}) },
    });
    return result.count > 0;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new MenuNameTakenError();
    throw e;
  }
}

/** 메뉴 보관 — 판매 기록과 레시피는 남기고 목록·계산에서만 뺀다. */
export async function archiveMenu(orgId: string, id: string): Promise<boolean> {
  return (await prisma.storeMenu.updateMany({ where: { id, organizationId: orgId }, data: { isActive: false } })).count > 0;
}

/** 레시피를 통째로 바꾼다. 하나라도 이 조직의 매장 품목이 아니면 아무것도 바꾸지 않는다. */
export async function setRecipe(orgId: string, menuId: string, lines: { itemId: string; quantity: number }[]): Promise<'ok' | 'not_found' | 'bad_item'> {
  const menu = await prisma.storeMenu.findFirst({ where: { id: menuId, organizationId: orgId }, select: { id: true } });
  if (!menu) return 'not_found';
  const ids = [...new Set(lines.map((l) => l.itemId))];
  if (ids.length !== lines.length) return 'bad_item';
  if (ids.length > 0 && (await prisma.sku.count({ where: { id: { in: ids }, ...storeItemWhere(orgId) } })) !== ids.length) return 'bad_item';
  await prisma.$transaction([
    prisma.storeRecipeLine.deleteMany({ where: { menuId } }),
    prisma.storeRecipeLine.createMany({ data: lines.map((l) => ({ menuId, skuId: l.itemId, quantity: l.quantity })) }),
  ]);
  return 'ok';
}

// ── 메뉴 판매 ─────────────────────────────────────────────────────────────────────────────────

const aliasKey = (name: string) => name.replace(/\s+/g, ' ').trim();

/** 파일의 메뉴 이름들을 메뉴에 맞춘다 — 상품코드 → 메뉴 이름 → 저장한 이름 연결 순서. */
export async function matchMenuNames(orgId: string, names: { name: string; code: string | null }[]): Promise<Map<string, MenuMatch>> {
  const [menus, aliases] = await Promise.all([
    prisma.storeMenu.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true, name: true, code: true } }),
    prisma.storeMenuAlias.findMany({ where: { organizationId: orgId }, select: { alias: true, menuId: true, menu: { select: { isActive: true } } } }),
  ]);
  const byCode = new Map(menus.filter((m) => m.code).map((m) => [m.code!, m.id]));
  const byName = new Map(menus.map((m) => [aliasKey(m.name), m.id]));
  const byAlias = new Map(aliases.map((a) => [a.alias, a.menuId && a.menu?.isActive ? a.menuId : a.menuId ? undefined : null]));
  const result = new Map<string, MenuMatch>();
  for (const { name, code } of names) {
    const key = aliasKey(name);
    if (code && byCode.has(code)) result.set(name, { kind: 'menu', menuId: byCode.get(code)!, via: 'code' });
    else if (byName.has(key)) result.set(name, { kind: 'menu', menuId: byName.get(key)!, via: 'name' });
    else if (byAlias.has(key)) {
      const menuId = byAlias.get(key);
      result.set(name, menuId ? { kind: 'menu', menuId, via: 'alias' } : menuId === null ? { kind: 'ignore' } : { kind: 'none' });
    } else result.set(name, { kind: 'none' });
  }
  return result;
}

export type MenuDecision = { name: string; code: string | null } & ({ action: 'menu'; menuId: string } | { action: 'new' } | { action: 'ignore' });

export interface MenuSaleLine {
  date: string;
  name: string;
  quantity: number;
  amount: number | null;
}

/**
 * 메뉴 판매를 저장한다. 사용자가 고른 대로 새 메뉴를 만들고, 파일 이름 ↔ 메뉴 연결(또는 무시)을 기억한 뒤,
 * 같은 날·같은 메뉴를 합쳐 덮어쓴다(다시 올려도 두 번 더해지지 않는다).
 */
export async function importMenuSales(orgId: string, input: { lines: MenuSaleLine[]; decisions: MenuDecision[] }) {
  const menus = await prisma.storeMenu.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, isActive: true } });
  const ownIds = new Set(menus.filter((m) => m.isActive).map((m) => m.id));
  if (input.decisions.some((d) => d.action === 'menu' && !ownIds.has(d.menuId))) return null;

  return prisma.$transaction(async (tx) => {
    const menuOf = new Map<string, string | null>();
    let created = 0;
    for (const d of input.decisions) {
      const key = aliasKey(d.name);
      if (d.action === 'ignore') {
        menuOf.set(d.name, null);
        await tx.storeMenuAlias.upsert({
          where: { organizationId_alias: { organizationId: orgId, alias: key } },
          create: { organizationId: orgId, alias: key, menuId: null },
          update: { menuId: null },
        });
        continue;
      }
      let menuId: string;
      if (d.action === 'new') {
        const existing = menus.find((m) => aliasKey(m.name) === key);
        if (existing) {
          menuId = existing.id;
          if (!existing.isActive) await tx.storeMenu.update({ where: { id: existing.id }, data: { isActive: true } });
        } else {
          menuId = (await tx.storeMenu.create({ data: { organizationId: orgId, name: key, code: d.code } })).id;
          menus.push({ id: menuId, name: key, isActive: true });
          created++;
        }
      } else {
        menuId = d.menuId;
        const menu = menus.find((m) => m.id === menuId)!;
        // 메뉴 이름과 다른 이름이면 연결을 기억한다.
        if (aliasKey(menu.name) !== key) {
          await tx.storeMenuAlias.upsert({
            where: { organizationId_alias: { organizationId: orgId, alias: key } },
            create: { organizationId: orgId, alias: key, menuId },
            update: { menuId },
          });
        }
      }
      menuOf.set(d.name, menuId);
    }

    const totals = new Map<string, { menuId: string; date: string; quantity: number; amount: number | null }>();
    for (const line of input.lines) {
      const menuId = menuOf.get(line.name);
      if (!menuId) continue;
      const k = `${menuId}|${line.date}`;
      const t = totals.get(k) ?? { menuId, date: line.date, quantity: 0, amount: null };
      t.quantity += line.quantity;
      if (line.amount !== null) t.amount = (t.amount ?? 0) + line.amount;
      totals.set(k, t);
    }
    for (const t of totals.values()) {
      const data = { quantity: t.quantity, amount: t.amount };
      await tx.menuSale.upsert({
        where: { menuId_date: { menuId: t.menuId, date: toDateOnly(t.date) } },
        create: { organizationId: orgId, menuId: t.menuId, date: toDateOnly(t.date), ...data },
        update: data,
      });
    }
    const dates = [...new Set([...totals.values()].map((t) => t.date))].sort();
    return { saved: totals.size, menusCreated: created, ignored: input.decisions.filter((d) => d.action === 'ignore').length, from: dates[0] ?? null, to: dates.at(-1) ?? null };
  });
}

export async function listMenuSales(orgId: string, from: string, to: string) {
  const rows = await prisma.menuSale.findMany({
    where: { organizationId: orgId, date: { gte: toDateOnly(from), lte: toDateOnly(to) }, menu: { isActive: true } },
    select: { menuId: true, date: true, quantity: true },
  });
  return rows.map((r) => ({ menuId: r.menuId, date: dateOnlyToString(r.date), quantity: Number(r.quantity) }));
}

export async function lastMenuSalesDate(orgId: string): Promise<string | null> {
  const row = await prisma.menuSale.findFirst({ where: { organizationId: orgId }, orderBy: { date: 'desc' }, select: { date: true } });
  return row ? dateOnlyToString(row.date) : null;
}

// ── 메뉴 판매 양식(직접 지정) ─────────────────────────────────────────────────────────────────
// 재고 업로드 양식과 같은 표(ImportTemplate)에 매장 방식(ORDER_CYCLE)으로 저장한다 — 머리글 지문이 같은 파일에 자동 적용.

const SEGMENT = 'ORDER_CYCLE' as const;

function toLayout(t: { headerRowIndex: number; columns: Prisma.JsonValue }): MenuSalesLayout {
  const raw = (t.columns ?? {}) as Record<string, unknown>;
  const columns: MenuSalesLayout['columns'] = {};
  for (const f of MENU_SALES_FIELDS) if (typeof raw[f] === 'string') columns[f] = raw[f] as string;
  return { headerRowIndex: t.headerRowIndex, columns };
}

/** 이 파일과 머리글이 같은 저장 양식. */
export async function findMenuSalesTemplate(orgId: string, aoa: string[][]): Promise<{ name: string; layout: MenuSalesLayout } | null> {
  const templates = await prisma.importTemplate.findMany({ where: { organizationId: orgId, segment: SEGMENT }, orderBy: { lastUsedAt: { sort: 'desc', nulls: 'last' } } });
  for (const t of templates) {
    const header = aoa[t.headerRowIndex];
    if (header && headerFingerprint(header) === t.fingerprint) return { name: t.name, layout: toLayout(t) };
  }
  return null;
}

export async function saveMenuSalesTemplate(orgId: string, name: string, headers: string[], layout: MenuSalesLayout) {
  const fingerprint = headerFingerprint(headers);
  const data = { name, headerRowIndex: layout.headerRowIndex, columns: layout.columns as Prisma.InputJsonValue, lastUsedAt: new Date() };
  await prisma.importTemplate.upsert({
    where: { organizationId_segment_fingerprint: { organizationId: orgId, segment: SEGMENT, fingerprint } },
    create: { organizationId: orgId, segment: SEGMENT, fingerprint, ...data },
    update: data,
  });
}

export async function touchMenuSalesTemplate(orgId: string, headers: string[]) {
  await prisma.importTemplate.updateMany({ where: { organizationId: orgId, segment: SEGMENT, fingerprint: headerFingerprint(headers) }, data: { lastUsedAt: new Date() } });
}
