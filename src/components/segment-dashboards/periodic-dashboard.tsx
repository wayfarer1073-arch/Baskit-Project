'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SectionPanel, SegmentDashboardHeader, SegmentEmptyState, SummaryMetric, SummaryPanel } from '@/components/segment-dashboards/dashboard-parts';
import { compareRecountUrgency, type PeriodicStatus } from '@/domain/segments/periodic-count';
import { CONFIDENCE_LABEL, STATUS_BADGE } from '@/components/segment-dashboards/periodic-parts';
import { PeriodicSkuSheet } from '@/components/segment-dashboards/periodic-sku-sheet';
import type { PeriodicRow } from '@/domain/segments/read-model';
import { formatNumber } from '@/lib/format';

const PAGE_SIZE = 50;

interface PeriodicDashboardProps {
  asOfDate: string;
  stockoutSoonDays: number;
  recountDays: number;
  rows: PeriodicRow[];
  warehouses: { id: string; name: string }[];
}

function quantity(value: number | null) {
  return value === null ? '—' : `${formatNumber(value)}`;
}

export function PeriodicDashboard({ asOfDate, stockoutSoonDays, recountDays, rows, warehouses }: PeriodicDashboardProps) {
  const [query, setQuery] = useState('');
  const [warehouseId, setWarehouseId] = useState('all');
  const [recountOnly, setRecountOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [openSkuId, setOpenSkuId] = useState<string | null>(null);

  const summary = useMemo(() => {
    const count = (status: PeriodicStatus) => rows.filter((r) => r.estimate.status === status).length;
    const recount = rows.filter((r) => r.estimate.recountReasons.length > 0).length;
    const avgDays = rows.length ? rows.reduce((sum, r) => sum + r.estimate.daysSinceCount, 0) / rows.length : 0;
    return { out: count('estimated_out'), soon: count('soon'), unknown: count('unknown'), recount, avgDays };
  }, [rows]);

  const recountQueue = useMemo(
    () =>
      rows
        .filter((r) => r.estimate.recountReasons.length > 0)
        .sort((a, b) => compareRecountUrgency(a.estimate, b.estimate))
        .slice(0, 8),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.replace(/\s+/g, '').toLowerCase();
    return rows
      .filter((r) => warehouseId === 'all' || r.warehouseId === warehouseId)
      .filter((r) => !recountOnly || r.estimate.recountReasons.length > 0)
      .filter((r) => !q || `${r.productCode}${r.productName}`.replace(/\s+/g, '').toLowerCase().includes(q))
      .sort((a, b) => compareRecountUrgency(a.estimate, b.estimate));
  }, [rows, query, warehouseId, recountOnly]);

  const header = (
    <SegmentDashboardHeader
      title="비정기 실사 대시보드"
      description={`마지막으로 센 수량과 그 사이 소진 속도로 지금 재고를 추정해요 · 기준일 ${asOfDate}`}
      action={
        <Link
          href="/count"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-accent px-3.5 py-2 text-sm font-medium text-brand-accent-foreground transition-opacity hover:opacity-90"
        >
          <ClipboardCheck className="size-4" aria-hidden="true" />
          실사 입력
        </Link>
      }
    />
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <SegmentEmptyState
          title="아직 실사 기록이 없어요"
          description="재고를 센 날 상품코드·상품명·수량을 직접 적거나 엑셀로 올리면, 다음 실사 전까지의 재고를 추정해 드려요. 소진 속도는 같은 상품을 두 번 이상 세면 계산됩니다."
          href="/count"
          cta="첫 실사 기록하기"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <SummaryPanel
        title="추정 재고 현황"
        tooltip={`실사와 실사 사이에 줄어든 양(그 사이 기록한 입고 포함)으로 하루 소진 속도를 구하고, 마지막 실사 이후 지난 날짜만큼 빼서 지금 재고를 추정해요. 오래 세지 않을수록 오차가 커지니 ${recountDays}일이 지나면 다시 세어보길 권합니다.`}
        footer="추정치예요. 발주 직전에는 실제 수량을 한 번 세어 확인하는 것을 권합니다."
      >
        <SummaryMetric label="추정 품절" value={`${summary.out}개`} emphasis={summary.out ? 'danger' : undefined} detail="추정 재고 0 이하" />
        <SummaryMetric label="품절 임박" value={`${summary.soon}개`} emphasis={summary.soon ? 'warning' : undefined} detail={`${stockoutSoonDays}일 안에 소진 예상`} />
        <SummaryMetric label="실사 권장" value={`${summary.recount}개`} detail={`${recountDays}일 경과 또는 임박·판단 불가`} />
        <SummaryMetric label="평균 실사 경과" value={`${Math.round(summary.avgDays)}일`} detail={`추적 중인 품목 ${rows.length}개`} />
      </SummaryPanel>

      {recountQueue.length > 0 && (
        <SectionPanel title="먼저 세어볼 품목" description="품절 가능성이 높거나 오래 세지 않은 순서예요 · 누르면 상세">
          <ul className="divide-y divide-border">
            {recountQueue.map((r) => (
              <li key={r.skuId}>
                <button
                  type="button"
                  onClick={() => setOpenSkuId(r.skuId)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <Badge variant={STATUS_BADGE[r.estimate.status].variant}>{STATUS_BADGE[r.estimate.status].label}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.warehouseName} · {r.productCode}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.estimate.recountReasons.map((reason) => (
                      <span key={reason} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {reason}
                      </span>
                    ))}
                  </div>
                  <p className="w-24 text-right text-sm tabular-nums">
                    <span className="text-xs text-muted-foreground">추정 </span>
                    {quantity(r.estimate.estimatedStock)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </SectionPanel>
      )}

      <SectionPanel
        title="전체 품목 추정 재고"
        description={`${filtered.length} / ${rows.length}개 표시 · 행을 누르면 상세`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
                placeholder="상품명·코드 검색"
                className="h-8 w-44 pl-8 text-sm"
                aria-label="상품 검색"
              />
            </div>
            {warehouses.length > 1 && (
              <Select
                value={warehouseId}
                onValueChange={(v) => {
                  setWarehouseId(v);
                  setVisibleCount(PAGE_SIZE);
                }}
              >
                <SelectTrigger className="h-8 w-36 text-sm" aria-label="창고 선택">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 창고</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex items-center gap-1.5">
              <Switch
                id="recount-only"
                checked={recountOnly}
                onCheckedChange={(v) => {
                  setRecountOnly(v);
                  setVisibleCount(PAGE_SIZE);
                }}
              />
              <Label htmlFor="recount-only" className="text-xs">
                실사 권장만
              </Label>
            </div>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>상품</TableHead>
                <TableHead>마지막 실사</TableHead>
                <TableHead className="text-right">실사 수량</TableHead>
                <TableHead className="text-right">이후 입고</TableHead>
                <TableHead className="text-right">일평균 소진</TableHead>
                <TableHead className="text-right">추정 재고</TableHead>
                <TableHead>예상 품절일</TableHead>
                <TableHead>신뢰도</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, visibleCount).map((r) => (
                <TableRow key={r.skuId} className="cursor-pointer" onClick={() => setOpenSkuId(r.skuId)}>
                  <TableCell className="max-w-64">
                    <button
                      type="button"
                      className="block max-w-full truncate text-left text-sm font-medium underline-offset-4 hover:underline"
                      title={r.productName}
                      onClick={() => setOpenSkuId(r.skuId)}
                    >
                      {r.productName}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {r.warehouseName} · {r.productCode}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {r.estimate.lastCountDate}
                    <span className="ml-1.5 text-xs text-muted-foreground">{r.estimate.daysSinceCount === 0 ? '오늘' : `${r.estimate.daysSinceCount}일 전`}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(r.estimate.lastCountQuantity)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.estimate.inboundSinceCount ? `+${formatNumber(r.estimate.inboundSinceCount)}` : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.estimate.dailyUsage === null ? '—' : r.estimate.dailyUsage.toFixed(1)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{quantity(r.estimate.estimatedStock)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{r.estimate.estimatedStockoutDate ?? '—'}</TableCell>
                  <TableCell className="text-sm">{CONFIDENCE_LABEL[r.estimate.confidence]}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[r.estimate.status].variant}>{STATUS_BADGE[r.estimate.status].label}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted-foreground">조건에 맞는 품목이 없어요.</p>}
          {filtered.length > visibleCount && (
            <div className="border-t border-border px-5 py-3 text-center">
              <Button variant="outline" size="sm" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                {Math.min(PAGE_SIZE, filtered.length - visibleCount)}개 더 보기 ({visibleCount} / {filtered.length})
              </Button>
            </div>
          )}
        </div>
      </SectionPanel>

      <PeriodicSkuSheet skuId={openSkuId} asOfDate={asOfDate} onOpenChange={(open) => !open && setOpenSkuId(null)} />
    </div>
  );
}
