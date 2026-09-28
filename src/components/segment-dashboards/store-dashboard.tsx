'use client';

import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SectionPanel, SegmentDashboardHeader, SegmentEmptyState, SummaryMetric, SummaryPanel } from '@/components/segment-dashboards/dashboard-parts';
import { WeeklySalesChart } from '@/components/segment-dashboards/weekly-sales-chart';
import { ORDER_SOON_DAYS, type ForecastConfidence, type OrderStatus } from '@/domain/segments/order-cycle';
import type { StoreDashboardData, StoreForecastRow } from '@/domain/segments/read-model';
import { formatCurrency } from '@/lib/format';

const STATUS_BADGE: Record<OrderStatus, { label: string; variant: 'danger' | 'warning' | 'normal' | 'stagnant' | 'increase' }> = {
  overdue: { label: '발주 지남', variant: 'danger' },
  today: { label: '오늘 발주', variant: 'danger' },
  soon: { label: '곧 발주', variant: 'warning' },
  ok: { label: '여유', variant: 'normal' },
  insufficient: { label: '기록 부족', variant: 'stagnant' },
  dormant: { label: '발주 중단?', variant: 'stagnant' },
};

const CONFIDENCE_LABEL: Record<ForecastConfidence, string> = { high: '높음', medium: '보통', low: '낮음', none: '—' };

function qty(value: number | null, unit: string) {
  if (value === null) return '—';
  const text = Number.isInteger(value) ? value.toLocaleString('ko-KR') : value.toFixed(1);
  return `${text}${unit}`;
}

function relativeDay(days: number | null) {
  if (days === null) return '';
  if (days === 0) return '오늘';
  if (days < 0) return `${-days}일 지남`;
  return `${days}일 후`;
}

function growthLabel(rate: number | null) {
  if (rate === null) return '비교 불가';
  const pct = Math.round(rate * 1000) / 10;
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

interface StoreDashboardProps extends StoreDashboardData {
  asOfDate: string;
}

export function StoreDashboard({ asOfDate, rows, sales }: StoreDashboardProps) {
  const header = (
    <SegmentDashboardHeader
      title="매장 발주 예측"
      description={`발주 간격과 최근 매출 추세로 다음 발주일을 예측해요 · 기준일 ${asOfDate}`}
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
          description="원두·우유·컵처럼 정기적으로 발주하는 품목과 발주 기록을 남기면, 발주 간격과 매출 추세로 다음 발주일과 수량을 알려드려요. 품목마다 발주 기록이 2번 이상 쌓이면 예측이 시작됩니다."
          href="/store/records"
          cta="품목 등록하기"
        />
      </div>
    );
  }

  const dueNow = rows.filter((r) => r.forecast.status === 'overdue' || r.forecast.status === 'today');
  const dueSoon = rows.filter((r) => r.forecast.status === 'soon');
  const forecastable = rows.filter((r) => r.forecast.recommendedOrderDate !== null && r.forecast.status !== 'dormant');
  const upcoming = rows
    .filter((r) => r.forecast.daysUntilOrder !== null && r.forecast.daysUntilOrder >= 0 && r.forecast.daysUntilOrder <= 7 && r.forecast.status !== 'dormant')
    .sort((a, b) => a.forecast.daysUntilOrder! - b.forecast.daysUntilOrder!);
  const scheduleGroups = groupByDate(upcoming);
  const growth = sales.growthRate;

  return (
    <div className="space-y-6">
      {header}

      <SummaryPanel
        title="발주 현황"
        tooltip="품목마다 '이번 발주량을 다음 발주 전까지 다 썼다'고 보고 하루 사용량을 구해요. 최근 4주 하루 평균 매출이 발주 기록이 쌓이던 때보다 늘었으면 그만큼 더 빨리, 줄었으면 더 늦게 발주하도록 보정합니다(0.5~2배 범위)."
        footer="예측은 발주 기록과 매출 입력이 꾸준할수록 정확해져요. 폐기·재고 이월이 많은 품목은 실제와 다를 수 있습니다."
      >
        <SummaryMetric label="지금 발주할 품목" value={`${dueNow.length}개`} emphasis={dueNow.length ? 'danger' : undefined} detail="권장 발주일이 오늘이거나 지남" />
        <SummaryMetric label="곧 발주" value={`${dueSoon.length}개`} emphasis={dueSoon.length ? 'warning' : undefined} detail={`${ORDER_SOON_DAYS}일 안에 권장 발주일`} />
        <SummaryMetric
          label="최근 4주 매출 추세"
          value={growthLabel(growth)}
          emphasis={growth === null ? undefined : growth >= 0 ? 'normal' : 'warning'}
          detail={sales.recentDailyAvg === null ? '매출 입력 필요' : `하루 평균 ${formatCurrency(sales.recentDailyAvg)} · 직전 4주 대비`}
        />
        <SummaryMetric label="예측 중인 품목" value={`${forecastable.length} / ${rows.length}`} detail="발주 기록 2회 이상" />
      </SummaryPanel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionPanel title="이번 주 발주 일정" description="권장 발주일 기준 · 리드타임 반영">
          {dueNow.length === 0 && scheduleGroups.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">7일 안에 발주할 품목이 없어요.</p>
          ) : (
            <div className="divide-y divide-border">
              {dueNow.length > 0 && <ScheduleGroup title="지금 발주" tone="danger" rows={dueNow} />}
              {scheduleGroups
                .filter((g) => g.days > 0)
                .map((g) => (
                  <ScheduleGroup key={g.date} title={`${g.date} · ${relativeDay(g.days)}`} rows={g.rows} />
                ))}
            </div>
          )}
        </SectionPanel>

        <SectionPanel title="주간 매출" description={sales.recentDailyAvg === null ? '매출을 입력하면 발주 예측에 반영돼요' : '최근 12주 · 이번 주는 진행 중'}>
          <div className="px-3 pt-3 pb-2">
            <WeeklySalesChart weekly={sales.weekly} />
          </div>
        </SectionPanel>
      </div>

      <SectionPanel title="품목별 발주 예측" description={`${rows.length}개 품목 · 급한 순`}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>품목</TableHead>
                <TableHead>마지막 발주</TableHead>
                <TableHead className="text-right">평균 간격</TableHead>
                <TableHead className="text-right">하루 사용량</TableHead>
                <TableHead className="text-right">매출 보정</TableHead>
                <TableHead>권장 발주일</TableHead>
                <TableHead className="text-right">권장 수량</TableHead>
                <TableHead>신뢰도</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const f = r.forecast;
                // 한동안 발주하지 않은 품목은 오래전 기준의 권장일·수량이 오히려 혼란을 주므로 숨긴다.
                const dormant = f.status === 'dormant';
                return (
                  <TableRow key={r.itemId}>
                    <TableCell>
                      <p className="text-sm font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">리드타임 {r.leadTimeDays}일</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {f.lastOrderDate ?? '—'}
                      {f.lastOrderQuantity !== null && <span className="ml-1.5 text-xs text-muted-foreground">{qty(f.lastOrderQuantity, r.unit)}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{f.avgIntervalDays === null ? '—' : `${f.avgIntervalDays.toFixed(1)}일`}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.adjustedDailyUsage === null ? '—' : `${f.adjustedDailyUsage.toFixed(2)}${r.unit}`}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.salesGrowthFactor === null ? '—' : `×${f.salesGrowthFactor.toFixed(2)}`}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {dormant ? '—' : (f.recommendedOrderDate ?? '—')}
                      {f.daysUntilOrder !== null && !dormant && <span className="ml-1.5 text-xs text-muted-foreground">{relativeDay(f.daysUntilOrder)}</span>}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{dormant ? '—' : qty(f.recommendedQuantity, r.unit)}</TableCell>
                    <TableCell className="text-sm">{CONFIDENCE_LABEL[f.confidence]}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[f.status].variant}>{STATUS_BADGE[f.status].label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </SectionPanel>
    </div>
  );
}

function groupByDate(rows: StoreForecastRow[]) {
  const groups: { date: string; days: number; rows: StoreForecastRow[] }[] = [];
  for (const r of rows) {
    const date = r.forecast.recommendedOrderDate!;
    const last = groups.at(-1);
    if (last && last.date === date) last.rows.push(r);
    else groups.push({ date, days: r.forecast.daysUntilOrder!, rows: [r] });
  }
  return groups;
}

function ScheduleGroup({ title, rows, tone }: { title: string; rows: StoreForecastRow[]; tone?: 'danger' }) {
  return (
    <div className="px-5 py-3">
      <p className={tone === 'danger' ? 'text-xs font-semibold text-status-danger' : 'text-xs font-medium text-muted-foreground'}>{title}</p>
      <ul className="mt-1.5 space-y-1">
        {rows.map((r) => (
          <li key={r.itemId} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{r.name}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              권장 <span className="font-medium text-foreground">{qty(r.forecast.recommendedQuantity, r.unit)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
