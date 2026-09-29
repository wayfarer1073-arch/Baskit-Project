'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

interface TopDepletionChartProps {
  items: { productName: string; depletion: number }[];
}

/** 순위 기반 단일 hue 순차 램프(짙은 잉크 -> 옅은 잉크). 무지개색 대신 중립 톤 하나만 쓴다. */
function rankColor(index: number, count: number): string {
  const t = count <= 1 ? 0 : index / (count - 1);
  const lightness = 0.26 + t * 0.22;
  return `oklch(${lightness.toFixed(3)} 0.02 260)`;
}

interface BarTooltipProps {
  active?: boolean;
  payload?: { payload: { fullName: string; value: number } }[];
}

/** 기본 Tooltip은 Y축 라벨(잘린 상품명)과 formatter 결과(전체 상품명)를 각각 한 줄씩 그려 상품명이
 * 두 번 겹쳐 보인다. 커스텀 content로 전체 상품명 한 줄 + 수량 한 줄만 그린다. */
function BarTooltip({ active, payload }: BarTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const { fullName, value } = payload[0].payload;
  return (
    <div
      style={{
        background: 'var(--color-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '8px 10px',
        fontSize: 12,
        maxWidth: 220,
      }}
    >
      <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{fullName}</div>
      <div style={{ marginTop: 2, color: 'var(--color-muted-foreground)' }}>{value.toLocaleString()}</div>
    </div>
  );
}

interface BarShapeProps {
  x: number;
  y: number;
  width: number;
  height: number;
  payload: { value: number; color: string };
}

/** 데이터 끝(막대 끝)만 둥글게, 기준선 쪽은 각지게 — 값은 호버 시 툴팁으로만 보여준다. */
function RankedBarShape(props: BarShapeProps) {
  const { x, y, width, height, payload } = props;
  const thickness = Math.min(height, 16);
  const barY = y + (height - thickness) / 2;
  const w = Math.max(width, 0);
  const radius = Math.min(4, thickness / 2, w);
  const fill = payload.color;

  return (
    <path
      d={`M ${x} ${barY} H ${x + Math.max(w - radius, 0)} A ${radius} ${radius} 0 0 1 ${x + w} ${barY + radius} V ${barY + thickness - radius} A ${radius} ${radius} 0 0 1 ${x + Math.max(w - radius, 0)} ${barY + thickness} H ${x} Z`}
      fill={fill}
    />
  );
}

const MAX_BARS = 7;
const LABEL_MAX_CHARS = 11;

export function TopDepletionChart({ items }: TopDepletionChartProps) {
  const { m } = useI18n();
  const t = m.dashboard.charts;
  const top = items.slice(0, MAX_BARS);
  const data = top.map((i, index) => ({
    name: i.productName.length > LABEL_MAX_CHARS ? `${i.productName.slice(0, LABEL_MAX_CHARS)}…` : i.productName,
    fullName: i.productName,
    value: i.depletion,
    color: rankColor(index, top.length),
  }));

  return (
    <div className="px-5 py-4">
      <h3 className="text-sm font-semibold">{format(t.topDepletion, { count: MAX_BARS })}</h3>
      <div className="mt-2 h-64">
        {data.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <BarChart3 className="size-5 opacity-40" aria-hidden="true" />
            <p className="text-sm">{t.accumulating}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barCategoryGap="32%">
              <CartesianGrid stroke="var(--color-border)" horizontal={false} />
              <XAxis type="number" fontSize={11} stroke="var(--color-muted-foreground)" tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" width={104} fontSize={11} stroke="var(--color-muted-foreground)" tickLine={false} axisLine={false} />
              <Tooltip content={<BarTooltip />} cursor={{ fill: 'var(--color-muted)' }} />
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Bar dataKey="value" shape={RankedBarShape as any} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
