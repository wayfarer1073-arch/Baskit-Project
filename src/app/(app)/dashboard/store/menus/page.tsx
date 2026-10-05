import { requireTenant } from '@/server/tenant';
import { requireEnabledSegment } from '@/server/segments';
import { listMenus, listRecipeItems } from '@/server/repositories/menu-repository';
import { getLossReport, getRecipeOverview } from '@/server/services/menu-service';
import { MenuRecipes } from '@/components/segment-dashboards/menu-recipes';
import { USAGE_PERIODS } from '@/domain/segments/recipe-usage';
import { shiftDate } from '@/domain/inventory/shipping-calendar';
import { todayKstDateString } from '@/lib/date';

/** 메뉴·레시피 — POS 메뉴 판매 업로드, 레시피 편집, 레시피 기반 소모량·예상 재고, 로스 리포트. ?days=7|14|30 */
export default async function MenuRecipesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const days = USAGE_PERIODS.find((d) => String(d) === params.days) ?? USAGE_PERIODS[0];
  const today = todayKstDateString();
  const tenant = await requireTenant();
  await requireEnabledSegment(tenant.orgId, 'ORDER_CYCLE');
  const [items, menus, overview, loss] = await Promise.all([
    listRecipeItems(tenant.orgId),
    listMenus(tenant.orgId, today),
    getRecipeOverview(tenant.orgId, shiftDate(today, -(days - 1)), today),
    getLossReport(tenant.orgId, today),
  ]);
  return <MenuRecipes items={items} menus={menus} overview={overview} loss={loss} days={days} today={today} readOnly={tenant.role === 'VIEWER'} />;
}
