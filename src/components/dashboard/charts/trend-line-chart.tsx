'use client';

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { formatKstDate } from '@/lib/date';
import { useI18n } from '@/components/i18n/i18n-provider';

interface TrendLineChartProps {
  title: string;
  data: { date: string; value: number }[];
  valueFormatter: (value: number) => string;
  color?: string;
}

export function TrendLineChart({ title, data, valueFormatter, color = 'var(--color-brand-accent)' }: TrendLineChartProps) {
  const { m, locale } = useI18n();
  const compact = new Intl.NumberFormat(locale === 'ko' ? 'ko-KR' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const gradientId = `trend-fill-${title.replace(/[^a-zA-Z0-9가-힣]+/g, '-')}`;
  return (
    <div className="px-5 py-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-2 h-60">
        {data.length < 2 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <TrendingUp className="size-5 opacity-40" aria-hidden="true" />
            <p className="text-sm">{m.dashboard.charts.accumulating}</p>
            <p className="text-xs">{m.dashboard.charts.needTwo}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.14} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => formatKstDate(d).slice(5)}
                fontSize={11}
                stroke="var(--color-muted-foreground)"
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                width={56}
                fontSize={11}
                stroke="var(--color-muted-foreground)"
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => (v >= 10000 ? compact.format(v) : `${v}`)}
              />
              <Tooltip
                formatter={(value) => [valueFormatter(Number(value)), title]}
                labelFormatter={(d) => formatKstDate(String(d))}
                cursor={{ stroke: 'var(--color-border)', strokeWidth: 1, strokeDasharray: '3 3' }}
                contentStyle={{ fontSize: 12, borderRadius: 10, border: 'none', background: 'var(--color-sidebar)', color: 'var(--color-sidebar-foreground)' }}
                labelStyle={{ color: 'var(--color-sidebar-muted-foreground)' }}
                itemStyle={{ color: 'var(--color-sidebar-foreground)' }}
              />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 4, stroke: 'var(--color-card)', strokeWidth: 2, fill: color }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
