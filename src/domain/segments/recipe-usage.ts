/**
 * 레시피 기반 이론 소모량 — 메뉴별 판매 수 × 레시피로 매장 품목이 얼마나 쓰였는지 계산한다.
 *
 * 레시피 양은 품목에 환산(예: 원두 1봉 = 1000 g)이 있으면 그 단위(g), 없으면 품목 단위로 적는다.
 * 소모량은 품목 단위(봉)로 바꿔 더한다. 이론값이므로 폐기·시음·과다 사용은 들어 있지 않다 —
 * Easy Count로 센 실제 재고와 비교하면 그 차이를 볼 수 있다.
 */

/** 소모량 화면에서 고를 수 있는 기간(일). */
export const USAGE_PERIODS = [7, 14, 30] as const;

export interface RecipeItem {
  id: string;
  name: string;
  unit: string;
  /** 품목 1단위에 든 양(레시피 단위). 없으면 레시피도 품목 단위. */
  contentPerUnit: number | null;
  contentUnit: string | null;
}

export interface RecipeMenu {
  id: string;
  name: string;
  lines: { itemId: string; quantity: number }[];
}

export interface MenuSaleRecord {
  menuId: string;
  date: string;
  quantity: number;
}

/** 레시피 양을 품목 단위로 — 환산이 있으면 나눈다. */
export function toItemUnits(item: Pick<RecipeItem, 'contentPerUnit'>, recipeQuantity: number): number {
  return item.contentPerUnit && item.contentPerUnit > 0 ? recipeQuantity / item.contentPerUnit : recipeQuantity;
}

export interface ItemUsage {
  itemId: string;
  /** 품목 단위 소모량. */
  units: number;
  /** 레시피 단위 소모량(환산이 있을 때만). */
  content: number | null;
  /** 날짜별 품목 단위 소모량. */
  byDate: Map<string, number>;
}

export interface UsageResult {
  items: Map<string, ItemUsage>;
  /** 판매는 있는데 레시피가 비어 있는 메뉴 — 소모량에 빠져 있으니 알려 준다. */
  menusWithoutRecipe: { menuId: string; name: string; quantity: number }[];
}

/** [from, to] 기간의 판매로 품목별 이론 소모량을 구한다. */
export function recipeUsage(items: RecipeItem[], menus: RecipeMenu[], sales: MenuSaleRecord[], from: string, to: string): UsageResult {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const menuById = new Map(menus.map((m) => [m.id, m]));
  const usage = new Map<string, ItemUsage>();
  const missing = new Map<string, { menuId: string; name: string; quantity: number }>();
  for (const sale of sales) {
    if (sale.date < from || sale.date > to) continue;
    const menu = menuById.get(sale.menuId);
    if (!menu) continue;
    const lines = menu.lines.filter((l) => itemById.has(l.itemId));
    if (lines.length === 0) {
      const entry = missing.get(menu.id) ?? { menuId: menu.id, name: menu.name, quantity: 0 };
      entry.quantity += sale.quantity;
      missing.set(menu.id, entry);
      continue;
    }
    for (const line of lines) {
      const item = itemById.get(line.itemId)!;
      const content = line.quantity * sale.quantity;
      const units = toItemUnits(item, content);
      const entry = usage.get(item.id) ?? { itemId: item.id, units: 0, content: item.contentPerUnit ? 0 : null, byDate: new Map<string, number>() };
      entry.units += units;
      if (entry.content !== null) entry.content += content;
      entry.byDate.set(sale.date, (entry.byDate.get(sale.date) ?? 0) + units);
      usage.set(item.id, entry);
    }
  }
  return { items: usage, menusWithoutRecipe: [...missing.values()].sort((a, b) => b.quantity - a.quantity) };
}

export interface StockEstimate {
  /** 기준이 된 Easy Count 날짜와 그때 재고(품목 단위). */
  baseDate: string;
  baseUnits: number;
  /** 그 뒤 들어온 발주와 레시피로 계산한 소모량. */
  orderedSince: number;
  usedSince: number;
  /** 기준 재고 + 발주 − 소모(0 미만이면 0). */
  estimatedUnits: number;
}

/**
 * 마지막으로 센 재고(Easy Count)에서 그 뒤 발주를 더하고 레시피 소모량을 빼 오늘 재고를 어림한다.
 * 센 날의 발주는 센 재고에 이미 들어 있다고 본다(받은 뒤 세는 것이 보통). 센 기록이 없으면 계산하지 않는다.
 */
export function estimateStock(
  lastCount: { date: string; fullUnits: number; openedPercent: number | null } | null,
  orders: { date: string; quantity: number }[],
  usageByDate: Map<string, number> | undefined,
  asOfDate: string,
): StockEstimate | null {
  if (!lastCount || lastCount.date > asOfDate) return null;
  const baseUnits = lastCount.fullUnits + (lastCount.openedPercent ?? 0) / 100;
  const orderedSince = orders.filter((o) => o.date > lastCount.date && o.date <= asOfDate).reduce((s, o) => s + o.quantity, 0);
  let usedSince = 0;
  for (const [date, units] of usageByDate ?? []) if (date > lastCount.date && date <= asOfDate) usedSince += units;
  return { baseDate: lastCount.date, baseUnits, orderedSince, usedSince, estimatedUnits: Math.max(0, baseUnits + orderedSince - usedSince) };
}
