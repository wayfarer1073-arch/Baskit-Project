'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ActionCenter } from '@/components/dashboard/action-center';
import { TodayActions } from '@/components/dashboard/today-actions';
import { buildTodayActions } from '@/domain/inventory/today-actions';
import { KpiCards } from '@/components/dashboard/kpi-cards';
import { OperatingSummary } from '@/components/dashboard/operating-summary';
import { WarehouseSummaryCards } from '@/components/dashboard/warehouse-summary-cards';
import { FavoritesSummary } from '@/components/dashboard/favorites-summary';
import { SpecialStockSummary, type SpecialSchedule } from '@/components/dashboard/special-stock-summary';
import { ChartsSection } from '@/components/dashboard/charts/charts-section';
import { InventoryTable } from '@/components/inventory-table/inventory-table';
import { SkuDetailSheet } from '@/components/inventory-table/sku-detail-sheet';
import { SoldOutSkuSheet } from '@/components/dashboard/sold-out-sku-sheet';
import { calculateCompanyKpis, calculateWarehouseSummaries, buildActionCenterCards } from '@/domain/inventory/aggregation';
import type { InventoryRow } from '@/domain/inventory/read-model';
import type { RiskThresholdSettings } from '@/domain/inventory/types';
import type { DailyWarehouseTotal } from '@/domain/inventory/read-model';
import type { QuickFilter, TableTab } from '@/lib/inventory-filters';
import { DashboardEmptyState, DashboardMasthead } from '@/components/dashboard/dashboard-masthead';
import { StaleDataBanner } from '@/components/dashboard/stale-data-banner';
import type { StockView } from '@/components/inventory-table/nowcast-stock';
import { usePersistedFlag } from '@/lib/use-persisted-flag';
import { useI18n } from '@/components/i18n/i18n-provider';
import { cn } from '@/lib/utils';
import { MergedInventoryTable } from '@/components/inventory-table/merged-inventory-table';
import { format } from '@/lib/i18n/locales';

interface LatestUpload {
  warehouseId: string;
  snapshotDate: string | null;
  uploadedAt: string | null;
}

interface DashboardClientProps {
  asOfDate: string;
  fromDate: string | null;
  warehouses: { id: string; code: string; name: string }[];
  settings: RiskThresholdSettings;
  rows: InventoryRow[];
  dailyTotals: DailyWarehouseTotal[];
  latestUploads: LatestUpload[];
  isAdmin: boolean;
  holidays: string[];
  favoriteSkuIds: string[];
  specialSchedules: Record<string, SpecialSchedule>;
}

export function DashboardClient({
  asOfDate,
  fromDate,
  warehouses,
  settings,
  rows,
  dailyTotals,
  latestUploads,
  isAdmin,
  holidays,
  favoriteSkuIds,
  specialSchedules,
}: DashboardClientProps) {
  const [warehouseFilter, setWarehouseFilter] = useState<string | 'ALL'>('ALL');
  const [tableTab, setTableTab] = useState<TableTab>('ALL');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);
  const [selectedSkuId, setSelectedSkuId] = useState<string | null>(null);
  const [soldOutPanelOpen, setSoldOutPanelOpen] = useState(false);
  const [combineWarehouses, setCombineWarehouses] = useState(false);
  const { m } = useI18n();
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set(favoriteSkuIds));

  const holidaySet = useMemo(() => new Set(holidays), [holidays]);
  const kpis = useMemo(() => calculateCompanyKpis(rows, settings.stagnantDays, fromDate, holidaySet), [rows, settings.stagnantDays, fromDate, holidaySet]);
  const warehouseSummaries = useMemo(() => calculateWarehouseSummaries(rows, settings.stagnantDays, holidaySet), [rows, settings.stagnantDays, holidaySet]);
  const actionCenterCards = useMemo(() => buildActionCenterCards(rows, settings.stagnantDays), [rows, settings.stagnantDays]);
  const todayActions = useMemo(() => buildTodayActions(rows, asOfDate, settings.stagnantDays), [rows, asOfDate, settings.stagnantDays]);
  const favoriteRows = useMemo(() => rows.filter((r) => favorites.has(r.descriptor.skuId)), [rows, favorites]);
  // 즐겨찾기한 SKU는 위쪽 즐겨찾기 섹션에서 보이므로, 아래 전체 재고 표에서는 중복 노출하지 않는다.
  // 품절 SKU는 1개월 동안 표에도 품절 배지로 남겨 둔다 — 품절이 이슈일 때 놓치지 않고 팔로우하도록.
  const tableRows = useMemo(() => rows.filter((r) => !favorites.has(r.descriptor.skuId)), [rows, favorites]);
  const specialRows = useMemo(() => rows.filter((r) => r.descriptor.isB2B), [rows]);
  const soldOutRows = useMemo(() => rows.filter((r) => r.descriptor.isSoldOut), [rows]);
  // 직전 재고 ↔ 예측치 슬라이드(표·즐겨찾기 각각 기억). 오늘 재고가 다 올라와 추정할 품목이 없으면 비활성.
  const stockViewDisabled = useMemo(() => !rows.some((r) => r.nowcast && r.nowcast.reason !== 'special' && !r.descriptor.isSoldOut), [rows]);
  const [tableEstimate, setTableEstimate] = usePersistedFlag('limenote_stock_view_table_estimate', true);
  const [favoritesEstimate, setFavoritesEstimate] = usePersistedFlag('limenote_stock_view_favorites_estimate', true);
  const tableView: StockView = tableEstimate ? 'estimate' : 'last';
  const favoritesView: StockView = favoritesEstimate ? 'estimate' : 'last';

  async function toggleFavorite(skuId: string, next: boolean) {
    setFavorites((prev) => {
      const nextSet = new Set(prev);
      if (next) nextSet.add(skuId);
      else nextSet.delete(skuId);
      return nextSet;
    });
    try {
      const res = await fetch(`/api/sku/${skuId}/favorite`, { method: next ? 'POST' : 'DELETE' });
      if (!res.ok) throw new Error();
    } catch {
      setFavorites((prev) => {
        const revert = new Set(prev);
        if (next) revert.delete(skuId);
        else revert.add(skuId);
        return revert;
      });
      toast.error(m.dashboard.favoriteFailed);
    }
  }

  function handleActionCenterSelect(tab: TableTab, qf: QuickFilter) {
    setTableTab(tab);
    setQuickFilter(qf);
    document.getElementById('inventory-table-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const masthead = (
    <DashboardMasthead
      segment="DAILY_SYNC"
      title={m.dashboard.title}
      segmentLabel={m.segments.DAILY_SYNC.label}
      description={fromDate ? format(m.dashboard.range, { from: fromDate, to: asOfDate }) : format(m.dashboard.asOf, { date: asOfDate })}
      asOfDate={asOfDate}
      fromDate={fromDate}
    />
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-7">
        {masthead}
        <DashboardEmptyState title={m.dashboard.emptyTitle} body={m.dashboard.emptyBody} href={`/upload?date=${asOfDate}&mode=DAILY_SYNC`} cta={m.dashboard.goUpload} />
      </div>
    );
  }

  return (
    <div className="space-y-9">
      <div className="space-y-4">
        {masthead}
        <StaleDataBanner rows={rows} asOfDate={asOfDate} />
      </div>
      <TodayActions actions={todayActions} onSelect={setSelectedSkuId} />
      <KpiCards kpis={kpis} fromDate={fromDate} asOfDate={asOfDate} onOpenSoldOutList={() => setSoldOutPanelOpen(true)} />
      <OperatingSummary rows={rows} />
      <ActionCenter cards={actionCenterCards} onSelect={handleActionCenterSelect} />
      <WarehouseSummaryCards summaries={warehouseSummaries} activeWarehouseId={warehouseFilter} onSelect={setWarehouseFilter} latestUploads={latestUploads} />
      <ChartsSection
        rows={rows}
        dailyTotals={dailyTotals}
        warehouses={warehouses}
        chartWarehouseId={warehouseFilter}
        onChangeChartWarehouse={setWarehouseFilter}
        fromDate={fromDate}
        asOfDate={asOfDate}
      />
      <FavoritesSummary
        rows={favoriteRows}
        onSelectSku={setSelectedSkuId}
        fromDate={fromDate}
        stockView={favoritesView}
        onStockViewChange={(view) => setFavoritesEstimate(view === 'estimate')}
        stockViewDisabled={stockViewDisabled}
      />
      <SpecialStockSummary rows={specialRows} schedules={specialSchedules} asOfDate={asOfDate} onSelectSku={setSelectedSkuId} />
      <div id="inventory-table-section" className="space-y-3">
        {warehouses.length > 1 && (
          <div role="group" aria-label={m.merged.toggleLabel} className="inline-flex rounded-lg border border-border p-0.5 text-xs">
            {[false, true].map((combined) => (
              <button
                key={String(combined)}
                type="button"
                aria-pressed={combineWarehouses === combined}
                onClick={() => setCombineWarehouses(combined)}
                className={cn(
                  'rounded-md px-3 py-1.5 font-medium transition-colors',
                  combineWarehouses === combined ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {combined ? m.merged.combined : m.merged.byWarehouse}
              </button>
            ))}
          </div>
        )}
        {combineWarehouses && warehouses.length > 1 ? (
          <MergedInventoryTable rows={rows} settings={settings} onSelectSku={setSelectedSkuId} />
        ) : (
          <InventoryTable
            rows={tableRows}
            warehouses={warehouses}
            warehouseFilter={warehouseFilter}
            onChangeWarehouseFilter={setWarehouseFilter}
            tab={tableTab}
            onChangeTab={(tab) => {
              setTableTab(tab);
              setQuickFilter(null);
            }}
            quickFilter={quickFilter}
            onClearQuickFilter={() => setQuickFilter(null)}
            onSelectSku={setSelectedSkuId}
            asOfDate={asOfDate}
            fromDate={fromDate}
            stockView={tableView}
            onStockViewChange={(view) => setTableEstimate(view === 'estimate')}
            stockViewDisabled={stockViewDisabled}
          />
        )}
      </div>
      <SoldOutSkuSheet
        rows={soldOutRows}
        open={soldOutPanelOpen}
        onOpenChange={setSoldOutPanelOpen}
        onSelectSku={(skuId) => {
          setSoldOutPanelOpen(false);
          setSelectedSkuId(skuId);
        }}
      />
      <SkuDetailSheet
        skuId={selectedSkuId}
        asOfDate={asOfDate}
        fromDate={fromDate}
        isAdmin={isAdmin}
        isFavorited={selectedSkuId !== null && favorites.has(selectedSkuId)}
        onToggleFavorite={toggleFavorite}
        onOpenChange={(open) => !open && setSelectedSkuId(null)}
      />
    </div>
  );
}
