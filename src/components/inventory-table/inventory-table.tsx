'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Building2, Columns3, Download, FileSpreadsheet, PackageX, Search, X } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { cn } from '@/lib/utils';
import { formatMoney, formatNumber, formatSigned } from '@/lib/format';
import { formatKstDate } from '@/lib/date';
import { analysisStatusText, dataReliabilityClassName, dataReliabilityLevel, dataReliabilityText, formatExpirationDday, humanizeTagText, isB2BTag, isBasisWindowTag, isEstimateCaveatTag, isExpirationRiskTag, isObservedDateTag, isSoldOutTag, isStaleDepletionTag, localizeReason } from '@/lib/status';
import { TABLE_TABS, matchesQuickFilter, matchesTab, type QuickFilter, type TableTab } from '@/lib/inventory-filters';
import { buildInventorySheetRows, type ExportRowInput } from '@/domain/excel/export';
import { downloadSheetsAsExcel } from '@/lib/xlsx-download';
import type { InventoryRow } from '@/domain/inventory/read-model';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

interface InventoryTableProps {
  rows: InventoryRow[];
  warehouses: { id: string; code: string; name: string }[];
  warehouseFilter: string | 'ALL';
  onChangeWarehouseFilter: (id: string | 'ALL') => void;
  tab: TableTab;
  onChangeTab: (tab: TableTab) => void;
  quickFilter: QuickFilter;
  onClearQuickFilter: () => void;
  onSelectSku: (skuId: string) => void;
  asOfDate: string;
  fromDate: string | null;
}

type SortKey =
  | 'stockoutFast'
  | 'coverageAsc'
  | 'depletionRateDesc'
  | 'accelerationDesc'
  | 'valueDesc'
  | 'stagnantDesc'
  | 'increaseDesc'
  | 'netChangeDesc';

const SORT_OPTIONS: SortKey[] = ['stockoutFast', 'coverageAsc', 'depletionRateDesc', 'accelerationDesc', 'valueDesc', 'stagnantDesc', 'increaseDesc', 'netChangeDesc'];

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/** 상품코드·상품명(항상 표시)을 제외한, 표시/숨김을 고를 수 있는 열. 검색 필터 바 우측 드롭다운에서 고른다. */
type ColumnKey =
  | 'status' | 'warehouse' | 'normalStock' | 'netChange' | 'depletion7d'
  | 'avgDepletion' | 'acceleration' | 'coverage' | 'stockoutDate'
  | 'unitCost' | 'inventoryValue' | 'stagnantDays';

const COLUMN_OPTIONS: ColumnKey[] = [
  'status',
  'warehouse',
  'normalStock',
  'netChange',
  'depletion7d',
  'avgDepletion',
  'acceleration',
  'coverage',
  'stockoutDate',
  'unitCost',
  'inventoryValue',
  'stagnantDays',
];

// 정렬 기준값은 반드시 해당 열에 실제로 표시되는 값과 같아야 한다 — 표시값과 다른 값으로 정렬하면
// (예: 표시는 순증감인데 정렬은 증가분만 반영) 오름차순/내림차순을 눌러도 체감상 정렬이 바뀌지
// 않는 것처럼 보이는 버그가 된다. 품절/B2B로 셀에 "-"·"0"·"원가 미상"을 표시하는 경우도 그 표시와
// 일치하도록 null 또는 0을 반환한다.
function sortValue(row: InventoryRow, key: SortKey): number | null {
  switch (key) {
    case 'stockoutFast':
      return row.analysis.forecast.expectedStockoutDays;
    case 'coverageAsc':
      return row.analysis.coverage.coverageDays;
    case 'depletionRateDesc':
      if (row.descriptor.isB2B || row.descriptor.isSoldOut) return null;
      return row.analysis.window7.averageDailyDepletion;
    case 'accelerationDesc':
      return row.analysis.acceleration.accelerationRatePercent;
    case 'valueDesc':
      if (row.descriptor.isSoldOut) return 0;
      if (row.analysis.latest.valuationKnown === false) return null;
      return row.valueBreakdown.normalStockValue;
    case 'stagnantDesc':
      return row.analysis.stagnation.isMeaningful ? row.analysis.stagnation.stagnantDays : null;
    case 'increaseDesc':
      return row.periodComparison
        ? row.periodComparison.totalIncrease
        : row.analysis.dailyChange !== null && row.analysis.dailyChange > 0 ? row.analysis.dailyChange : null;
    // "직전 관측 대비"/"기간 변화" 열이 실제로 보여주는 값(순증감, 감소도 음수로 포함)과 동일한
    // 기준으로 정렬한다. increaseDesc는 증가분만 보는 별도 지표(정렬 드롭다운 전용)라 이 열의
    // 헤더 클릭 정렬에는 맞지 않는다 — 대부분의 행이 감소(null 처리)라 정렬이 안 먹는 것처럼 보였다.
    case 'netChangeDesc':
      return row.periodComparison ? row.periodComparison.netChange : row.analysis.dailyChange;
    default:
      return null;
  }
}

const ASCENDING_BY_DEFAULT: SortKey[] = ['stockoutFast', 'coverageAsc'];

export function InventoryTable({
  rows,
  warehouses,
  warehouseFilter,
  onChangeWarehouseFilter,
  tab,
  onChangeTab,
  quickFilter,
  onClearQuickFilter,
  onSelectSku,
  asOfDate,
  fromDate,
}: InventoryTableProps) {
  const { m } = useI18n();
  const t = m.inventory;
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'DANGER' | 'WARNING' | 'NORMAL' | 'UNKNOWN'>('ALL');
  const [coverageMin, setCoverageMin] = useState('');
  const [coverageMax, setCoverageMax] = useState('');
  const [costMin, setCostMin] = useState('');
  const [costMax, setCostMax] = useState('');
  const [showNormal, setShowNormal] = useState(true);
  const [showB2B, setShowB2B] = useState(true);
  const [trendFilter, setTrendFilter] = useState<'ALL' | 'ACCELERATING' | 'DECELERATING'>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('coverageAsc');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnKey>>(new Set());

  function toggleColumn(key: ColumnKey) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const isVisible = (key: ColumnKey) => !hiddenColumns.has(key);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (warehouseFilter !== 'ALL' && r.descriptor.warehouseId !== warehouseFilter) return false;
      if (!matchesTab(r.analysis, tab)) return false;
      if (!matchesQuickFilter(r.analysis, quickFilter)) return false;
      if (q && !r.descriptor.productName.toLowerCase().includes(q) && !r.descriptor.productCode.toLowerCase().includes(q)) return false;
      if (riskFilter !== 'ALL' && r.analysis.thresholdRisk.level !== riskFilter) return false;
      if (coverageMin && (r.analysis.coverage.coverageDays === null || r.analysis.coverage.coverageDays < Number(coverageMin))) return false;
      if (coverageMax && (r.analysis.coverage.coverageDays === null || r.analysis.coverage.coverageDays > Number(coverageMax))) return false;
      if (costMin && r.analysis.latest.unitCost < Number(costMin)) return false;
      if (costMax && r.analysis.latest.unitCost > Number(costMax)) return false;
      if (trendFilter !== 'ALL' && r.analysis.acceleration.trend !== trendFilter) return false;
      if (!showNormal && !r.descriptor.isB2B) return false;
      if (!showB2B && r.descriptor.isB2B) return false;
      return true;
    });
  }, [rows, warehouseFilter, tab, quickFilter, search, riskFilter, coverageMin, coverageMax, costMin, costMax, trendFilter, showNormal, showB2B]);

  const sorted = useMemo(() => {
    const withValue = filtered.map((r) => ({ row: r, value: sortValue(r, sortKey) }));
    withValue.sort((a, b) => {
      if (a.value === null && b.value === null) return 0;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return sortAsc ? a.value - b.value : b.value - a.value;
    });
    return withValue.map((w) => w.row);
  }, [filtered, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  // 필터를 바꿔 전체 페이지 수가 줄어들면(예: 3페이지 보던 중 1페이지 분량만 남음) page state가
  // 미처 갱신되지 않아 범위 밖 페이지를 slice해 빈 화면이 나올 수 있다. 항상 유효 범위로 고정한다.
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(ASCENDING_BY_DEFAULT.includes(key));
    }
    setPage(1);
  }

  function downloadCurrentView() {
    const exportRows: ExportRowInput[] = sorted.map((r) => ({
      productCode: r.descriptor.productCode,
      productName: r.descriptor.productName,
      warehouseName: r.descriptor.warehouseName,
      analysis: r.analysis,
      valueBreakdown: r.valueBreakdown,
    }));
    downloadSheetsAsExcel([{ name: t.exportSheet, rows: buildInventorySheetRows(exportRows) }], format(t.exportFile, { date: asOfDate }));
  }

  return (
    <section className="scroll-mt-20 overflow-hidden rounded-xl border border-border">
      <div className="flex flex-col gap-3 bg-sidebar px-5 py-3.5 text-sidebar-foreground sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">{t.title}</h2>
          <p className="mt-0.5 text-xs text-sidebar-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="text-xs text-sidebar-muted-foreground">{format(t.count, { count: sorted.length.toLocaleString() })}</span>
          <Button variant="outline" size="sm" className="text-foreground hover:text-brand-accent" onClick={downloadCurrentView}>
            <Download className="size-3.5" /> {t.downloadView}
          </Button>
          <Button variant="outline" size="sm" className="text-foreground hover:text-brand-accent" asChild>
            <a href={`/api/export/full-report?asOf=${asOfDate}${fromDate ? `&from=${fromDate}` : ''}`}>
              <FileSpreadsheet className="size-3.5" /> {t.fullReport}
            </a>
          </Button>
        </div>
      </div>

      <div className="space-y-3 p-4 sm:p-5">
      <Tabs
        value={tab}
        onValueChange={(v) => {
          onChangeTab(v as TableTab);
          setPage(1);
        }}
      >
        <TabsList>
          {TABLE_TABS.map((tabItem) => (
            <TabsTrigger key={tabItem.value} value={tabItem.value}>
              {t.tabs[tabItem.value]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {quickFilter && (
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline">{t.quickFilterOn}</Badge>
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={onClearQuickFilter}>
            <X className="size-3" /> {t.clearFilter}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t.search}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="h-8 w-48 pl-7 text-xs"
          />
        </div>

        <Select value={warehouseFilter} onValueChange={(v) => onChangeWarehouseFilter(v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t.warehouse} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t.allWarehouses}</SelectItem>
            {warehouses.map((w) => (
              <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={riskFilter} onValueChange={(v) => setRiskFilter(v as typeof riskFilter)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t.risk} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t.allRisks}</SelectItem>
            <SelectItem value="DANGER">{m.domain.risk.DANGER}</SelectItem>
            <SelectItem value="WARNING">{m.domain.risk.WARNING}</SelectItem>
            <SelectItem value="NORMAL">{m.domain.risk.NORMAL}</SelectItem>
            <SelectItem value="UNKNOWN">{m.domain.risk.UNKNOWN}</SelectItem>
          </SelectContent>
        </Select>

        <Select value={trendFilter} onValueChange={(v) => setTrendFilter(v as typeof trendFilter)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t.trend} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t.allTrends}</SelectItem>
            <SelectItem value="ACCELERATING">{t.acceleratingOnly}</SelectItem>
            <SelectItem value="DECELERATING">{t.deceleratingOnly}</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {t.coverageRange}
          <Input value={coverageMin} onChange={(e) => setCoverageMin(e.target.value)} placeholder="min" className="h-8 w-16 text-xs" inputMode="numeric" />
          ~
          <Input value={coverageMax} onChange={(e) => setCoverageMax(e.target.value)} placeholder="max" className="h-8 w-16 text-xs" inputMode="numeric" />
          {t.daysSuffix}
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {t.costRange}
          <Input value={costMin} onChange={(e) => setCostMin(e.target.value)} placeholder="min" className="h-8 w-20 text-xs" inputMode="numeric" />
          ~
          <Input value={costMax} onChange={(e) => setCostMax(e.target.value)} placeholder="max" className="h-8 w-20 text-xs" inputMode="numeric" />
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <Checkbox checked={showNormal} onCheckedChange={(c) => setShowNormal(c === true)} />
            {t.normalB2C}
          </label>
          <label className="flex items-center gap-1.5">
            <Checkbox checked={showB2B} onCheckedChange={(c) => setShowB2B(c === true)} />
            B2B
          </label>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Select value={sortKey} onValueChange={(v) => toggleSort(v as SortKey)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t.sort} /></SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((o) => (
                <SelectItem key={o} value={o}>{t.sortOptions[o]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                <Columns3 className="size-3.5" /> {t.columns}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{t.columnsTitle}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLUMN_OPTIONS.map((c) => (
                <DropdownMenuCheckboxItem key={c} checked={isVisible(c)} onCheckedChange={() => toggleColumn(c)} onSelect={(e) => e.preventDefault()}>
                  {t.cols[c]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-2 py-1.5">{t.cols.productCode}</TableHead>
              <TableHead className="min-w-[180px] px-2 py-1.5">{t.cols.productName}</TableHead>
              {isVisible('status') && (
                <TableHead className="px-2 py-1.5">
                  <HeaderLabel label={t.cols.status} tooltip={t.tips.status} />
                </TableHead>
              )}
              {isVisible('warehouse') && <TableHead className="px-2 py-1.5">{t.cols.warehouse}</TableHead>}
              {isVisible('normalStock') && <TableHead className="px-2 py-1.5 text-right">{t.cols.normalStock}</TableHead>}
              {isVisible('netChange') && (
                <SortableHead
                  label={fromDate ? t.cols.periodChange : t.cols.netChange}
                  tooltip={fromDate ? t.tips.periodChange : t.tips.netChange}
                  active={sortKey === 'netChangeDesc'}
                  asc={sortAsc}
                  onClick={() => toggleSort('netChangeDesc')}
                />
              )}
              {isVisible('depletion7d') && (
                <TableHead className="hidden px-2 py-1.5 text-right xl:table-cell">
                  <HeaderLabel label={t.cols.depletion7d} tooltip={t.tips.depletion7d} />
                </TableHead>
              )}
              {isVisible('avgDepletion') && (
                <SortableHead
                  className="hidden 2xl:table-cell"
                  label={t.cols.avgDepletion}
                  tooltip={t.tips.avgDepletion}
                  active={sortKey === 'depletionRateDesc'}
                  asc={sortAsc}
                  onClick={() => toggleSort('depletionRateDesc')}
                />
              )}
              {isVisible('acceleration') && (
                <SortableHead
                  label={t.cols.acceleration}
                  tooltip={t.tips.acceleration}
                  active={sortKey === 'accelerationDesc'}
                  asc={sortAsc}
                  onClick={() => toggleSort('accelerationDesc')}
                />
              )}
              {isVisible('coverage') && (
                <SortableHead
                  label={t.cols.coverage}
                  tooltip={t.tips.coverage}
                  active={sortKey === 'coverageAsc'}
                  asc={sortAsc}
                  onClick={() => toggleSort('coverageAsc')}
                />
              )}
              {isVisible('stockoutDate') && (
                <SortableHead
                  label={t.cols.stockoutDate}
                  tooltip={t.tips.stockoutDate}
                  active={sortKey === 'stockoutFast'}
                  asc={sortAsc}
                  onClick={() => toggleSort('stockoutFast')}
                />
              )}
              {isVisible('unitCost') && <TableHead className="hidden px-2 py-1.5 text-right 2xl:table-cell">{t.cols.unitCost}</TableHead>}
              {isVisible('inventoryValue') && (
                <SortableHead
                  label={t.cols.inventoryValue}
                  tooltip={t.tips.inventoryValue}
                  active={sortKey === 'valueDesc'}
                  asc={sortAsc}
                  onClick={() => toggleSort('valueDesc')}
                />
              )}
              {isVisible('stagnantDays') && (
                <SortableHead
                  className="hidden xl:table-cell"
                  label={t.cols.stagnantDays}
                  tooltip={t.tips.stagnantDays}
                  active={sortKey === 'stagnantDesc'}
                  asc={sortAsc}
                  onClick={() => toggleSort('stagnantDesc')}
                />
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={2 + COLUMN_OPTIONS.length - hiddenColumns.size} className="h-24 text-center text-sm text-muted-foreground">
                  {t.empty}
                </TableCell>
              </TableRow>
            )}
            {pageRows.map((r) => (
              <InventoryTableRow key={r.descriptor.skuId} row={r} fromDate={fromDate} onSelectSku={onSelectSku} hiddenColumns={hiddenColumns} />
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t.pageSize}</span>
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger className="h-8 w-[84px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>{format(t.pageSizeOption, { count: n })}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
              {m.dashboard.prev}
            </Button>
            <span className="text-xs text-muted-foreground">
              {currentPage} / {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>
              {m.dashboard.next}
            </Button>
          </div>
        )}
      </div>
      </div>
    </section>
  );
}

/** 헤더 라벨 + 선택적 느낌표 툴팁. 정렬 가능/불가능 헤더 양쪽에서 같은 형태로 재사용한다. */
function HeaderLabel({ label, tooltip }: { label: string; tooltip?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      {tooltip && <InfoTooltip>{tooltip}</InfoTooltip>}
    </span>
  );
}

function SortableHead({
  label,
  tooltip,
  active,
  asc,
  onClick,
  className,
}: {
  label: string;
  tooltip?: string;
  active: boolean;
  asc: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <TableHead className={cn('px-2 py-1.5 text-right', className)}>
      <span className="inline-flex items-center gap-1">
        <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-foreground">
          {label}
          {active ? asc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
        </button>
        {tooltip && <InfoTooltip>{tooltip}</InfoTooltip>}
      </span>
    </TableHead>
  );
}

/** 정렬 불가능한 고정 헤더 — 즐겨찾기 등 전체 재고 현황과 같은 열 구성을 재사용하되 정렬 UI는 없는 곳에서 쓴다. */
export function InventoryTableStaticHeader({ fromDate }: { fromDate: string | null }) {
  const c = useI18n().m.inventory.cols;
  return (
    <TableRow>
      <TableHead className="px-2 py-1.5">{c.productCode}</TableHead>
      <TableHead className="min-w-[180px] px-2 py-1.5">{c.productName}</TableHead>
      <TableHead className="px-2 py-1.5">{c.status}</TableHead>
      <TableHead className="px-2 py-1.5">{c.warehouse}</TableHead>
      <TableHead className="px-2 py-1.5 text-right">{c.normalStock}</TableHead>
      <TableHead className="px-2 py-1.5 text-right">{fromDate ? c.periodChange : c.netChange}</TableHead>
      <TableHead className="hidden px-2 py-1.5 text-right xl:table-cell">{c.depletion7d}</TableHead>
      <TableHead className="hidden px-2 py-1.5 text-right 2xl:table-cell">{c.avgDepletion}</TableHead>
      <TableHead className="px-2 py-1.5 text-right">{c.acceleration}</TableHead>
      <TableHead className="px-2 py-1.5 text-right">{c.coverage}</TableHead>
      <TableHead className="px-2 py-1.5 text-right">{c.stockoutDate}</TableHead>
      <TableHead className="hidden px-2 py-1.5 text-right 2xl:table-cell">{c.unitCost}</TableHead>
      <TableHead className="px-2 py-1.5 text-right">{c.inventoryValue}</TableHead>
      <TableHead className="hidden px-2 py-1.5 text-right xl:table-cell">{c.stagnantDays}</TableHead>
    </TableRow>
  );
}

/** 전체 재고 현황 테이블의 행 하나. 같은 형식으로 즐겨찾기 등 다른 곳에서도 재사용한다.
 * hiddenColumns는 검색 필터 바의 "열 표시" 드롭다운에서 고른, 감춰야 할 열이다(상품코드·상품명 제외).
 * 즐겨찾기 요약 등 그 드롭다운이 없는 곳에서는 넘기지 않으면 모든 열이 그대로 보인다. */
export function InventoryTableRow({
  row: r,
  fromDate,
  onSelectSku,
  hiddenColumns,
}: {
  row: InventoryRow;
  fromDate: string | null;
  onSelectSku: (skuId: string) => void;
  hiddenColumns?: ReadonlySet<ColumnKey>;
}) {
  const isVisible = (key: ColumnKey) => !hiddenColumns?.has(key);
  const { m, locale } = useI18n();
  const t = m.inventory.row;
  return (
    <TableRow
      tabIndex={0}
      role="button"
      aria-label={format(t.openDetail, { name: r.descriptor.productName })}
      onClick={() => onSelectSku(r.descriptor.skuId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSelectSku(r.descriptor.skuId);
        }
      }}
      className="cursor-pointer outline-none focus-visible:bg-muted/60 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <TableCell className="px-2 py-1.5 font-mono text-xs text-muted-foreground">{r.descriptor.productCode}</TableCell>
      <TableCell className="px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{r.descriptor.productName}</span>
          {r.descriptor.isSoldOut && (
            <>
              <Badge variant="soldout" className="gap-1 px-1.5 py-0 text-[10px]">
                <PackageX className="size-2.5" aria-hidden="true" />
                {t.soldOut}
              </Badge>
              <InfoTooltip>
                {format(t.soldOutTip, { date: r.descriptor.soldOutDetectedDate ?? '' })}
              </InfoTooltip>
            </>
          )}
          {r.descriptor.isB2B && (
            <>
              <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px]">
                <Building2 className="size-2.5" aria-hidden="true" />
                B2B
              </Badge>
              <InfoTooltip>
                {t.b2bTip}
              </InfoTooltip>
            </>
          )}
        </div>
        <div className="mt-0.5 flex flex-nowrap items-center gap-1 overflow-hidden">
          <span className={cn('shrink-0 text-[10px] font-medium whitespace-nowrap', dataReliabilityClassName(dataReliabilityLevel(r.analysis)))}>
            {dataReliabilityText(dataReliabilityLevel(r.analysis), m.domain)}
          </span>
          {r.analysis.expirationRisk.isAtRisk && r.analysis.expirationRisk.daysUntilExpiration !== null && (
            <Badge variant="warning" className="shrink-0 px-1.5 py-0 text-[10px] font-semibold">
              {formatExpirationDday(r.analysis.expirationRisk.daysUntilExpiration)}
            </Badge>
          )}
          {r.analysis.tags
            .filter((tag) => !isObservedDateTag(tag) && !isEstimateCaveatTag(tag) && !isBasisWindowTag(tag) && !isExpirationRiskTag(tag) && !isSoldOutTag(tag) && !isStaleDepletionTag(tag) && !isB2BTag(tag))
            .slice(0, 2)
            .map((tag) => (
              <span key={tag} className="shrink-0 text-[10px] whitespace-nowrap text-muted-foreground">{humanizeTagText(tag, m.domain)}</span>
            ))}
        </div>
      </TableCell>
      {isVisible('status') && (
        <TableCell className="px-2 py-1.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium">
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                r.analysis.thresholdRisk.level === 'DANGER' && 'bg-status-danger',
                r.analysis.thresholdRisk.level === 'WARNING' && 'bg-status-warning',
                r.analysis.thresholdRisk.level === 'NORMAL' && 'bg-status-normal',
                r.analysis.thresholdRisk.level === 'UNKNOWN' && 'bg-muted-foreground',
              )}
              aria-hidden="true"
            />
            {analysisStatusText(r.analysis, m.domain)}
          </span>
        </TableCell>
      )}
      {isVisible('warehouse') && <TableCell className="px-2 py-1.5">{r.descriptor.warehouseCode}</TableCell>}
      {isVisible('normalStock') && (
        <TableCell className="px-2 py-1.5 text-right tabular-nums">{r.descriptor.isSoldOut ? "0" : formatNumber(r.analysis.latest.normalStock)}</TableCell>
      )}
      {isVisible('netChange') && (
        <TableCell className="px-2 py-1.5 text-right tabular-nums">
          {fromDate ? (
            r.periodComparison ? (
              <div>
                <span className={r.periodComparison.netChange > 0 ? 'text-status-increase' : r.periodComparison.netChange < 0 ? 'text-status-warning' : ''}>
                  {formatSigned(r.periodComparison.netChange)}
                </span>
                <div className="text-[10px] text-muted-foreground">{format(t.periodDetail, { depletion: formatNumber(r.periodComparison.totalDepletion), increase: formatNumber(r.periodComparison.totalIncrease) })}</div>
              </div>
            ) : <span className="text-muted-foreground">{t.notComparable}</span>
          ) : r.analysis.dailyChange === null ? <span className="text-muted-foreground">{t.accumulating}</span> : formatSigned(r.analysis.dailyChange)}
        </TableCell>
      )}
      {isVisible('depletion7d') && (
        <TableCell className="hidden px-2 py-1.5 text-right tabular-nums xl:table-cell"><div>{r.descriptor.isSoldOut || r.analysis.window7.observedIntervalDays === 0 ? "—" : formatNumber(r.analysis.window7.totalDepletion)}</div><div className="text-[10px] text-muted-foreground">{format(t.observedDays, { days: r.analysis.window7.observedIntervalDays })}</div></TableCell>
      )}
      {isVisible('avgDepletion') && (
        <TableCell className="hidden px-2 py-1.5 text-right tabular-nums 2xl:table-cell">
          {r.descriptor.isB2B || r.descriptor.isSoldOut || r.analysis.window7.averageDailyDepletion === null ? '-' : formatNumber(r.analysis.window7.averageDailyDepletion)}
        </TableCell>
      )}
      {isVisible('acceleration') && (
        <TableCell className="px-2 py-1.5 text-right tabular-nums">
          {r.analysis.acceleration.accelerationRatePercent === null ? (
            <span className="text-muted-foreground">{r.analysis.acceleration.trend === 'NEW_DEPLETION' ? t.newDepletion : '-'}</span>
          ) : (
            <span className={r.analysis.acceleration.trend === 'ACCELERATING' ? 'text-status-danger' : r.analysis.acceleration.trend === 'DECELERATING' ? 'text-status-increase' : ''}>
              {formatSigned(r.analysis.acceleration.accelerationRatePercent)}%
            </span>
          )}
        </TableCell>
      )}
      {isVisible('coverage') && (
        <TableCell className="px-2 py-1.5 text-right tabular-nums"><div>{r.analysis.coverage.coverageDays === null ? "—" : format(t.shippingDays, { days: formatNumber(r.analysis.coverage.coverageDays) })}</div><div className="text-[10px] text-muted-foreground">{r.analysis.operating?.reason ? localizeReason(r.analysis.operating.reason, m.domain) : format(t.basis, { days: r.analysis.operating?.basisWindowDays ?? 7 })}</div></TableCell>
      )}
      {isVisible('stockoutDate') && (
        <TableCell className="px-2 py-1.5 text-right text-xs">
          {r.analysis.forecast.expectedStockoutDate ? formatKstDate(r.analysis.forecast.expectedStockoutDate) : <span className="text-muted-foreground">{t.notComputable}</span>}
        </TableCell>
      )}
      {isVisible('unitCost') && (
        <TableCell className="hidden px-2 py-1.5 text-right tabular-nums 2xl:table-cell">{formatNumber(r.analysis.latest.unitCost)}</TableCell>
      )}
      {isVisible('inventoryValue') && (
        <TableCell className="px-2 py-1.5 text-right tabular-nums">{r.descriptor.isSoldOut ? "0" : r.analysis.latest.valuationKnown === false ? t.unknownCost : formatMoney(r.valueBreakdown.normalStockValue, locale)}</TableCell>
      )}
      {isVisible('stagnantDays') && (
        <TableCell className="hidden px-2 py-1.5 text-right tabular-nums xl:table-cell">
          {r.analysis.stagnation.isMeaningful ? format(t.shippingDays, { days: r.analysis.stagnation.stagnantDays }) : <span className="text-muted-foreground">-</span>}
        </TableCell>
      )}
    </TableRow>
  );
}
