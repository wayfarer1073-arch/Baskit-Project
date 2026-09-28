'use client';

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCurrency } from '@/lib/format';
import type { SalesTrend } from '@/domain/segments/sales-coverage';

interface Datum {
  label: string;
  weekStart: string;
  total: number;
  recordedDays: number;
  inProgress: boolean;
}

function SalesTooltip({ active, payload }: { active?: boolean; payload?: { payload: Datum }[] }) {
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{d.weekStart} 주{d.inProgress ? ' (진행 중)' : ''}</p>
      <p className="mt-0.5 tabular-nums text-foreground">{formatCurrency(d.total)}</p>
      <p className="text-muted-foreground">매출 입력 {d.recordedDays}일</p>
    </div>
  );
}

function compactWon(value: number) {
  if (value >= 100_000_000) return `${Math.round(value / 10_000_000) / 10}억`;
  if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString('ko-KR')}만`;
  return value.toLocaleString('ko-KR');
}

/** 주간 매출 합계(월요일 시작). 이번 주는 아직 끝나지 않아 옅게 칠하고 툴팁에 "진행 중"으로 표시한다. */
export function WeeklySalesChart({ weekly }: { weekly: SalesTrend['weekly'] }) {
  const data: Datum[] = weekly.map((w, i) => ({
    ...w,
    label: `${Number(w.weekStart.slice(5, 7))}/${Number(w.weekStart.slice(8, 10))}`,
    inProgress: i === weekly.length - 1,
  }));
  return (
    <div className="h-56 w-full" role="img" aria-label="최근 12주 주간 매출 막대 차트">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="label" fontSize={11} stroke="var(--color-muted-foreground)" tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis fontSize={11} stroke="var(--color-muted-foreground)" tickLine={false} axisLine={false} width={44} tickFormatter={compactWon} />
          <Tooltip content={<SalesTooltip />} cursor={{ fill: 'var(--color-muted)' }} />
          <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={28}>
            {data.map((d) => (
              <Cell key={d.weekStart} fill="var(--color-chart-1)" fillOpacity={d.inProgress ? 0.4 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
