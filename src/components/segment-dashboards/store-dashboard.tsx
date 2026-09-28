'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SectionPanel, SegmentDashboardHeader, SegmentEmptyState, SummaryMetric, SummaryPanel } from '@/components/segment-dashboards/dashboard-parts';
import { WeeklySalesChart } from '@/components/segment-dashboards/weekly-sales-chart';
import { CoverageBar, CoverageStatusBadge, remainingText, remainingUnitsText, SOURCE_LABEL } from '@/components/segment-dashboards/coverage-parts';
import { StoreItemSheet } from '@/components/segment-dashboards/store-item-sheet';
import type { StoreDashboardData, StoreCoverageRow } from '@/domain/segments/read-model';
import { formatCurrency } from '@/lib/format';

function qty(value: number, unit: string) {
  return `${Number.isInteger(value) ? value.toLocaleString('ko-KR') : value.toFixed(1)}${unit}`;
}

function growthLabel(rate: number | null) {
  if (rate === null) return '비교 불가';
  const pct = Math.round(rate * 1000) / 10;
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

interface StoreDashboardProps extends StoreDashboardData {
  asOfDate: string;
}

export function StoreDashboard({ asOfDate, rows, sales, lastSalesDate, checkRemainingPct }: StoreDashboardProps) {
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const header = (
    <SegmentDashboardHeader
      title="매장 발주 예측"
      description={`발주 때 적은 '충족 매출'과 매일 매출로 발주가 필요한 때를 알려드려요 · 기준일 ${asOfDate}`}
      action={
        <Link
          href="/store/records"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-accent px-3.5 py-2 text-sm font-medium text-brand-accent-foreground transition-opacity hover:opacity-90"
        >
          <ClipboardList className="size-4" aria-hidden="true" />
          발주·매출 기록
        </Link>
      }
    />
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <SegmentEmptyState
          title="발주하는 품목부터 등록해 주세요"
          description="원두·우유·컵처럼 발주하는 품목과 발주처(리드타임)를 설정에서 등록하고, 발주할 때 '이 양으로 얼마어치 매출을 감당할지'를 적어 주세요. 그다음 매일 매출만 입력하면 발주가 필요할 때 알려드려요. 발주를 반복할수록 그 금액을 앱이 스스로 학습해요."
          href="/settings?tab=store"
          cta="품목 등록하기"
        />
      </div>
    );
  }

  const count = (s: StoreCoverageRow['analysis']['status']) => rows.filter((r) => r.analysis.status === s).length;
  const needed = count('order_needed');
  const check = count('check_needed');
  const learning = rows.filter((r) => r.analysis.learnedCycles > 0).length;
  const checklist = rows.filter((r) => ['order_needed', 'check_needed', 'needs_coverage'].includes(r.analysis.status));
  const salesGap = lastSalesDate ? daysBetween(lastSalesDate, asOfDate) : null;

  return (
    <div className="space-y-6">
      {header}

      {(salesGap === null || salesGap > 1) && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-status-warning/40 bg-status-warning-bg px-5 py-3 text-sm">
          <span className="text-status-warning">
            {salesGap === null ? '아직 입력된 매출이 없어요.' : `마지막 매출 입력이 ${lastSalesDate}(${salesGap}일 전)이에요.`} 빠진 날은 최근 평균으로 채워 계산하지만, 실제 매출을
            넣을수록 정확해져요.
          </span>
          <Link href="/store/records#sales" className="font-medium text-status-warning underline underline-offset-4">
            매출 입력하기
          </Link>
        </div>
      )}

      <SummaryPanel
        title="발주 현황"
        tooltip={`발주할 때 입력한 '충족 매출'에서 발주 이후 매출을 빼 남은 여유를 봐요. 여유가 ${checkRemainingPct}% 이하(또는 리드타임 동안 팔릴 매출 이하)가 되면 '발주 확인 필요', 다 쓰면 '발주 필요'예요. 같은 품목을 다시 발주할 때마다 실제로 얼마를 감당했는지 학습해 충족 매출을 스스로 보정합니다. 기준 %는 설정 > 매장 발주 예측에서 바꿀 수 있어요.`}
        footer="매출을 입력하지 않은 지난 날은 최근 4주 하루 평균 매출로 채워 계산해요."
      >
        <SummaryMetric label="발주 필요" value={`${needed}개`} emphasis={needed ? 'danger' : undefined} detail="충족 매출을 다 씀" />
        <SummaryMetric label="발주 확인 필요" value={`${check}개`} emphasis={check ? 'warning' : undefined} detail={`남은 여유 ${checkRemainingPct}% 이하`} />
        <SummaryMetric
          label="최근 4주 매출 추세"
          value={growthLabel(sales.growthRate)}
          emphasis={sales.growthRate === null ? undefined : sales.growthRate >= 0 ? 'normal' : 'warning'}
          detail={sales.recentDailyAvg === null ? '매출 입력 필요' : `하루 평균 ${formatCurrency(sales.recentDailyAvg)}`}
        />
        <SummaryMetric label="학습 중인 품목" value={`${learning} / ${rows.length}`} detail="같은 품목을 다시 발주하면 학습 시작" />
      </SummaryPanel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionPanel title="발주 체크리스트" description="지금 확인이 필요한 품목 · 누르면 상세">
          {checklist.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">지금 확인할 품목이 없어요.</p>
          ) : (
            <ul className="divide-y divide-border">
              {checklist.map((r) => (
                <li key={r.itemId}>
                  <button type="button" onClick={() => setOpenItemId(r.itemId)} className="w-full px-5 py-3 text-left transition-colors hover:bg-muted/50">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium">{r.name}</span>
                      <CoverageStatusBadge status={r.analysis.status} />
                    </div>
                    <CoverageBar analysis={r.analysis} checkPct={checkRemainingPct} className="mt-2" />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {remainingText(r.analysis)}
                      {remainingUnitsText(r.analysis, r.unit) && <> · 예상 잔량 {remainingUnitsText(r.analysis, r.unit)}</>}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionPanel>

        <SectionPanel title="주간 매출" description={sales.recentDailyAvg === null ? '매출을 입력하면 발주 판단에 반영돼요' : '최근 12주 · 이번 주는 진행 중'}>
          <div className="px-3 pt-3 pb-2">
            <WeeklySalesChart weekly={sales.weekly} />
          </div>
        </SectionPanel>
      </div>

      <SectionPanel title="품목별 발주 현황" description={`${rows.length}개 품목 · 급한 순 · 행을 누르면 상세`}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>품목</TableHead>
                <TableHead>마지막 발주</TableHead>
                <TableHead className="text-right">충족 매출 기준</TableHead>
                <TableHead className="text-right">발주 후 매출</TableHead>
                <TableHead className="min-w-40">진행률</TableHead>
                <TableHead>예상 잔량</TableHead>
                <TableHead>확인 예상일</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const a = r.analysis;
                return (
                  <TableRow key={r.itemId} className="cursor-pointer" onClick={() => setOpenItemId(r.itemId)}>
                    <TableCell>
                      <button type="button" className="text-left text-sm font-medium underline-offset-4 hover:underline" onClick={() => setOpenItemId(r.itemId)}>
                        {r.name}
                      </button>
                      <p className="text-xs text-muted-foreground">
                        {r.supplierName ? `${r.supplierName} · ` : ''}리드타임 {r.leadTimeDays}일{a.learnedCycles > 0 ? ` · 학습 ${a.learnedCycles}회` : ''}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {a.lastOrder ? (
                        <>
                          {a.lastOrder.date}
                          <span className="ml-1.5 text-xs text-muted-foreground">{qty(a.lastOrder.quantity, r.unit)}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <span className="tabular-nums">{a.estimate.amount === null ? '—' : formatCurrency(a.estimate.amount)}</span>
                      {a.estimate.source !== 'none' && <p className="text-[11px] text-muted-foreground">{SOURCE_LABEL[a.estimate.source]}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">{a.lastOrder ? formatCurrency(a.consumedSales) : '—'}</TableCell>
                    <TableCell>
                      <CoverageBar analysis={a} checkPct={checkRemainingPct} />
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">{remainingUnitsText(a, r.unit) ?? '—'}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {a.status === 'ok' ? (a.expectedCheckDate ?? '—') : a.status === 'check_needed' || a.status === 'order_needed' ? '지금' : '—'}
                    </TableCell>
                    <TableCell>
                      <CoverageStatusBadge status={a.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </SectionPanel>

      <StoreItemSheet itemId={openItemId} asOfDate={asOfDate} onOpenChange={(open) => !open && setOpenItemId(null)} />
    </div>
  );
}
