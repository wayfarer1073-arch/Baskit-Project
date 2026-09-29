'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ActionCenter } from '@/components/dashboard/action-center';
import { TodayActions } from '@/components/dashboard/today-actions';
import { buildTodayActions } from '@/domain/inventory/today-actions';
import { KpiCards } from '@/components/dashboard/kpi-cards';
import { OperatingSummary } from '@/components/dashboard/operating-summary';
import { WarehouseSummaryCards } from '@/components/dashboard/warehouse-summary-cards';
import { FavoritesSummary } from '@/components/dashboard/favorites-summary';
import { ChartsSection } from '@/components/dashboard/charts/charts-section';
import { InventoryTable } from '@/components/inventory-table/inventory-table';
import { SkuDetailSheet } from '@/components/inventory-table/sku-detail-sheet';
import { SoldOutSkuSheet } from '@/components/dashboard/sold-out-sku-sheet';
import { calculateCompanyKpis, calculateWarehouseSummaries, buildActionCenterCards } from '@/domain/inventory/aggregation';
import type { InventoryRow } from '@/domain/inventory/read-model';
import type { RiskThresholdSettings } from '@/domain/inventory/types';
import type { DailyWarehouseTotal } from '@/domain/inventory/read-model';
import type { QuickFilter, TableTab } from '@/lib/inventory-filters';
import { DateRangeControl } from '@/components/dashboard/date-range-control';
import { todayKstDateString } from '@/lib/date';

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
}

export function DashboardClient({ asOfDate, fromDate, warehouses, settings, rows, dailyTotals, latestUploads, isAdmin, holidays, favoriteSkuIds }: DashboardClientProps) {
  const [warehouseFilter, setWarehouseFilter] = useState<string | 'ALL'>('ALL');
  const [tableTab, setTableTab] = useState<TableTab>('ALL');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);
  const [selectedSkuId, setSelectedSkuId] = useState<string | null>(null);
  const [soldOutPanelOpen, setSoldOutPanelOpen] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set(favoriteSkuIds));

  const holidaySet = useMemo(() => new Set(holidays), [holidays]);
  const kpis = useMemo(() => calculateCompanyKpis(rows, settings.stagnantDays, fromDate, holidaySet), [rows, settings.stagnantDays, fromDate, holidaySet]);
  const warehouseSummaries = useMemo(() => calculateWarehouseSummaries(rows, settings.stagnantDays, holidaySet), [rows, settings.stagnantDays, holidaySet]);
  const actionCenterCards = useMemo(() => buildActionCenterCards(rows, settings.stagnantDays), [rows, settings.stagnantDays]);
  const todayActions = useMemo(() => buildTodayActions(rows, asOfDate, settings.stagnantDays), [rows, asOfDate, settings.stagnantDays]);
  const favoriteRows = useMemo(() => rows.filter((r) => favorites.has(r.descriptor.skuId)), [rows, favorites]);
  // 즐겨찾기한 SKU는 위쪽 즐겨찾기 섹션에서 보이므로, 아래 전체 재고 표에서는 중복 노출하지 않는다.
  const tableRows = useMemo(() => rows.filter((r) => !favorites.has(r.descriptor.skuId)), [rows, favorites]);
  const soldOutRows = useMemo(() => rows.filter((r) => r.descriptor.isSoldOut), [rows]);

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
      toast.error('즐겨찾기 변경에 실패했습니다.');
    }
  }

  function handleActionCenterSelect(tab: TableTab, qf: QuickFilter) {
    setTableTab(tab);
    setQuickFilter(qf);
    document.getElementById('inventory-table-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-7">
        <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight sm:text-[32px]">재고 운영 현황</h1>
            <p className="mt-1 text-sm text-muted-foreground">{asOfDate} 기준 재고 상태입니다.</p>
          </div>
          <DateRangeControl key={`${fromDate ?? 'day'}-${asOfDate}`} asOfDate={asOfDate} fromDate={fromDate} maxDate={todayKstDateString()} />
        </div>
        <div className="flex items-center justify-center py-12">
          <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-dashed bg-card p-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <UploadCloud className="size-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">아직 업로드된 재고 데이터가 없습니다</h2>
              <p className="mt-1 text-sm text-muted-foreground">창고별 Excel을 업로드하면 대시보드가 자동으로 채워집니다.</p>
            </div>
            <Button asChild>
              <Link href="/upload">
                <UploadCloud className="size-4" /> 업로드 하러 가기
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-9">
      <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight sm:text-[32px]">재고 운영 현황</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {fromDate ? `${fromDate}부터 ${asOfDate}까지의 변화와 현재 상태를 함께 봅니다.` : `${asOfDate} 기준 재고 상태입니다.`}
          </p>
        </div>
        <DateRangeControl key={`${fromDate ?? 'day'}-${asOfDate}`} asOfDate={asOfDate} fromDate={fromDate} maxDate={todayKstDateString()} />
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
      <FavoritesSummary rows={favoriteRows} onSelectSku={setSelectedSkuId} fromDate={fromDate} />
      <div id="inventory-table-section">
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
        />
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
