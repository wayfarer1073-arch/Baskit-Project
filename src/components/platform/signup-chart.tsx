'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PlatformMetrics } from '@/domain/platform/read-model';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

function SignupTooltip({ active, payload }: { active?: boolean; payload?: { payload: { date: string; count: number } }[] }) {
  const t = useI18n().m.platform.signups;
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{d.date}</p>
      <p className="mt-0.5 tabular-nums text-foreground">{format(t.value, { count: d.count })}</p>
    </div>
  );
}

/** 최근 30일 일별 신규 워크스페이스 수(데모 제외). */
export function SignupChart({ data }: { data: PlatformMetrics['signupsByDay'] }) {
  const rows = data.map((d) => ({ ...d, label: `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}` }));
  return (
    <div className="h-44 w-full" role="img" aria-label={useI18n().m.platform.signups.aria}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap="20%">
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="label" fontSize={11} stroke="var(--color-muted-foreground)" tickLine={false} axisLine={false} interval={6} />
          <YAxis allowDecimals={false} fontSize={11} stroke="var(--color-muted-foreground)" tickLine={false} axisLine={false} width={32} />
          <Tooltip content={<SignupTooltip />} cursor={{ fill: 'var(--color-muted)' }} />
          <Bar dataKey="count" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
