import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';
import { shiftDate } from '@/domain/inventory/shipping-calendar';
import { detectMenuSalesLayout, findPeriod, parseMenuSales, type MenuSalesLayout } from '@/domain/excel/menu-sales';
import { parseReceiptText, RECEIPT_LAYOUT, receiptToAoa } from '@/domain/excel/receipt-text';
import { estimateStock, recipeUsage } from '@/domain/segments/recipe-usage';
import { compareLoss, countIntervalLoss, type CountPoint } from '@/domain/segments/loss-report';
import type { LossReport, LossReportRow, MenuSalesPreview, RecipeOverview } from '@/domain/segments/read-model';
import { findMenuSalesTemplate, lastMenuSalesDate, listMenuSales, listMenus, listRecipeItems, matchMenuNames } from '@/server/repositories/menu-repository';

const TOP_ROWS = 15;

/**
 * 메뉴 판매 파일 미리보기 — 열은 (사용자가 고른 양식) → (저장한 양식) → (기본 인식: OKPOS 등) 순서로 정하고,
 * 메뉴 이름을 앱 메뉴에 맞춰 본다. 실제 저장은 사용자가 확인한 뒤 import에서 한다.
 */
export async function previewMenuSales(orgId: string, aoa: string[][], options: { layout?: MenuSalesLayout | null; date?: string | null }): Promise<MenuSalesPreview> {
  let source: MenuSalesPreview['source'] = 'none';
  let templateName: string | null = null;
  let layout: MenuSalesLayout | null = null;
  if (options.layout) {
    layout = options.layout;
    source = 'manual';
  } else {
    const template = await findMenuSalesTemplate(orgId, aoa);
    if (template) {
      layout = template.layout;
      source = 'template';
      templateName = template.name;
    } else {
      layout = detectMenuSalesLayout(aoa);
      if (layout) source = 'auto';
    }
  }
  const topRows = aoa.slice(0, TOP_ROWS).map((r) => r.slice(0, 20));
  const empty: MenuSalesPreview = {
    headerRowIndex: layout?.headerRowIndex ?? 0,
    headers: (aoa[layout?.headerRowIndex ?? 0] ?? []).map((h) => h.trim()),
    columns: layout?.columns ?? {},
    source,
    templateName,
    periodDate: null,
    periodRange: null,
    needsDate: false,
    rows: [],
    dates: [],
    skipped: 0,
    missing: ['menuName', 'quantity'],
    names: [],
    topRows,
  };
  if (!layout) return empty;

  const period = findPeriod(aoa, layout.headerRowIndex);
  const fallbackDate = options.date ?? period.date;
  const parsed = parseMenuSales(aoa, layout, fallbackDate);
  const byName = new Map<string, { name: string; code: string | null; quantity: number; amount: number | null }>();
  for (const row of parsed.rows) {
    const entry = byName.get(row.name) ?? { name: row.name, code: row.code, quantity: 0, amount: null };
    entry.quantity += row.quantity;
    if (row.amount !== null) entry.amount = (entry.amount ?? 0) + row.amount;
    byName.set(row.name, entry);
  }
  const matches = await matchMenuNames(orgId, [...byName.values()]);
  return {
    ...empty,
    headers: parsed.headers,
    periodDate: period.date,
    periodRange: period.range,
    needsDate: parsed.rows.some((r) => r.date === null),
    rows: parsed.rows,
    dates: [...new Set(parsed.rows.map((r) => r.date).filter((d): d is string => d !== null))].sort(),
    skipped: parsed.skipped,
    missing: parsed.missing,
    names: [...byName.values()].sort((a, b) => b.quantity - a.quantity).map((n) => ({ ...n, match: matches.get(n.name) ?? { kind: 'none' } })),
  };
}

/**
 * 마감 정산서 글자 미리보기 — 판매 줄을 뽑아 파일 미리보기와 같은 메뉴 연결 단계로 넘긴다.
 * 날짜는 영수증에 찍힌 날짜를 제안만 하고(화면에서 바꿀 수 있게) 줄에는 넣지 않는다.
 */
export async function previewReceipt(orgId: string, text: string, engine: string): Promise<MenuSalesPreview> {
  const receipt = parseReceiptText(text);
  const preview = await previewMenuSales(orgId, receiptToAoa(receipt), { layout: RECEIPT_LAYOUT, date: null });
  return {
    ...preview,
    source: 'receipt',
    periodDate: receipt.date,
    skipped: preview.skipped + receipt.skipped,
    topRows: [],
    receipt: { text, engine, date: receipt.date },
  };
}

/**
 * 레시피 기반 이론 소모량과 예상 재고 — [from, to] 판매 × 레시피, 그리고 마지막 Easy Count 기록에서
 * 그 뒤 발주를 더하고 소모를 뺀 오늘 재고.
 */
export async function getRecipeOverview(orgId: string, from: string, to: string): Promise<RecipeOverview> {
  const [items, menus, lastSales] = await Promise.all([listRecipeItems(orgId), listMenus(orgId, to), lastMenuSalesDate(orgId)]);
  const itemIds = items.map((i) => i.id);
  const [counts, orders] = await Promise.all([
    prisma.storeStockCount.findMany({
      where: { skuId: { in: itemIds }, countDate: { lte: new Date(`${to}T00:00:00.000Z`) } },
      orderBy: { countDate: 'desc' },
      distinct: ['skuId'],
      select: { skuId: true, countDate: true, fullUnits: true, openedPercent: true },
    }),
    prisma.purchaseOrder.findMany({ where: { skuId: { in: itemIds } }, select: { skuId: true, orderDate: true, quantity: true } }),
  ]);
  const lastCountBySku = new Map(counts.map((c) => [c.skuId, { date: dateOnlyToString(c.countDate), fullUnits: Number(c.fullUnits), openedPercent: c.openedPercent }]));
  // 예상 재고는 마지막 실사 이후 소모가 필요하므로, 기간 시작과 가장 이른 실사일 중 앞선 날부터 판매를 읽는다.
  const earliestCount = [...lastCountBySku.values()].reduce<string | null>((min, c) => (min === null || c.date < min ? c.date : min), null);
  const salesFrom = earliestCount && earliestCount < from ? shiftDate(earliestCount, 1) : from;
  const sales = await listMenuSales(orgId, salesFrom, to);
  const period = recipeUsage(items, menus, sales, from, to);
  const sinceCount = recipeUsage(items, menus, sales, salesFrom, to);
  const days = new Set(sales.filter((s) => s.date >= from).map((s) => s.date)).size;

  const rows = items.map((item) => {
    const usage = period.items.get(item.id);
    const itemOrders = orders.filter((o) => o.skuId === item.id).map((o) => ({ date: dateOnlyToString(o.orderDate), quantity: Number(o.quantity) }));
    return {
      item,
      units: usage?.units ?? 0,
      content: usage?.content ?? (item.contentPerUnit ? 0 : null),
      dailyAverage: days > 0 ? (usage?.units ?? 0) / days : null,
      estimate: estimateStock(lastCountBySku.get(item.id) ?? null, itemOrders, sinceCount.items.get(item.id)?.byDate, to),
    };
  });
  rows.sort((a, b) => b.units - a.units || a.item.name.localeCompare(b.item.name));
  return { from, to, asOfDate: to, rows, menusWithoutRecipe: period.menusWithoutRecipe, salesDays: days, lastSalesDate: lastSales };
}

/** 로스 리포트를 볼 때 거슬러 올라가는 실사 기간(일) — 두 실사가 이보다 멀면 비교하지 않는다. */
const LOSS_LOOKBACK_DAYS = 120;

/**
 * 로스 리포트 — 레시피에 쓰이는 품목마다 가장 최근 두 번의 Easy Count 사이에서
 * 실제 사용(앞 실사 + 발주 − 뒤 실사)과 레시피 기준 소모량을 비교한다.
 */
export async function getLossReport(orgId: string, asOfDate: string): Promise<LossReport> {
  const [items, menus] = await Promise.all([listRecipeItems(orgId), listMenus(orgId, asOfDate)]);
  const inRecipes = new Set(menus.flatMap((m) => m.lines.map((l) => l.itemId)));
  const recipeItems = items.filter((i) => inRecipes.has(i.id));
  const ids = recipeItems.map((i) => i.id);
  const lookback = new Date(`${shiftDate(asOfDate, -LOSS_LOOKBACK_DAYS)}T00:00:00.000Z`);
  const counts = await prisma.storeStockCount.findMany({
    where: { skuId: { in: ids }, countDate: { gte: lookback, lte: new Date(`${asOfDate}T00:00:00.000Z`) } },
    orderBy: { countDate: 'desc' },
    select: { skuId: true, countDate: true, fullUnits: true, openedPercent: true },
  });
  const pairs = new Map<string, CountPoint[]>();
  for (const c of counts) {
    const list = pairs.get(c.skuId) ?? [];
    if (list.length < 2) list.push({ date: dateOnlyToString(c.countDate), fullUnits: Number(c.fullUnits), openedPercent: c.openedPercent });
    pairs.set(c.skuId, list);
  }
  const ready = recipeItems.filter((i) => pairs.get(i.id)?.length === 2);
  if (ready.length === 0) return { asOfDate, rows: [], waiting: recipeItems.length, inRecipes: recipeItems.length };

  const earliest = ready.map((i) => pairs.get(i.id)![1].date).reduce((min, d) => (d < min ? d : min));
  const latest = ready.map((i) => pairs.get(i.id)![0].date).reduce((max, d) => (d > max ? d : max));
  const readyIds = ready.map((i) => i.id);
  const [sales, orders, costs] = await Promise.all([
    listMenuSales(orgId, shiftDate(earliest, 1), latest),
    prisma.purchaseOrder.findMany({
      where: { skuId: { in: readyIds }, orderDate: { gt: new Date(`${earliest}T00:00:00.000Z`), lte: new Date(`${latest}T00:00:00.000Z`) } },
      select: { skuId: true, orderDate: true, quantity: true },
    }),
    prisma.sku.findMany({ where: { id: { in: readyIds } }, select: { id: true, currentUnitCost: true } }),
  ]);
  const usage = recipeUsage(items, menus, sales, shiftDate(earliest, 1), latest);
  const salesDates = new Set(sales.map((s) => s.date));
  const costById = new Map(costs.map((c) => [c.id, Number(c.currentUnitCost)]));
  const rows: LossReportRow[] = ready.map((item) => {
    const [end, start] = pairs.get(item.id)!;
    const itemOrders = orders.filter((o) => o.skuId === item.id).map((o) => ({ date: dateOnlyToString(o.orderDate), quantity: Number(o.quantity) }));
    const cost = costById.get(item.id) ?? 0;
    return { item, unitCost: cost > 0 ? cost : null, loss: countIntervalLoss(start, end, itemOrders, usage.items.get(item.id)?.byDate, salesDates) };
  });
  rows.sort(compareLoss);
  return { asOfDate, rows, waiting: recipeItems.length - ready.length, inRecipes: recipeItems.length };
}
