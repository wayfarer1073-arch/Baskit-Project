'use client';

import { useEffect, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { PieChart as PieChartIcon } from 'lucide-react';
import { formatNumber } from '@/lib/format';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

interface RiskDistributionChartProps {
  danger: number;
  warning: number;
  normal: number;
  unknown?: number;
}

const RADIAN = Math.PI / 180;

/** 좁은 화면에서는 리드선이 카드 폭을 넘어가 라벨 글자가 잘린다. sm 미만에서는 도넛을
 * 작게, 리드선을 짧게 그려 라벨이 카드 안쪽에 들어오게 한다. */
function useIsCompactChart() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return compact;
}

interface LeaderLabelProps {
  sliceKey: string;
  detail: string;
  cx: number;
  cy: number;
  midAngle: number;
  outerRadius: number;
  value: number;
  percent: number;
  name: string;
  fill: string;
  compact: boolean;
}

/**
 * 위험/주의가 아주 작은 조각(전체의 8% 미만)으로 서로 붙어있으면 실제 각도 그대로 라벨을 두었을 때
 * 겹칠 수 있다. 그 경우에만 두 라벨을 세로로 살짝 떨어뜨린다. 그 외에는 항상 해당 조각의 실제
 * 각도에서 계산한 위치를 쓴다 — 조각 비율이 커질 때 리더라인이 조각과 무관한 고정 위치로
 * 튀어서 차트 밖으로 나가 보이던 문제(회귀 테스트 대상)를 막는다.
 */
const SMALL_SLICE_THRESHOLD = 0.08;
const SMALL_SLICE_NUDGE: Record<string, number> = { DANGER: -16, WARNING: 16 };

function LeaderLineLabel({ cx, cy, midAngle, outerRadius, value, percent, name, sliceKey, detail, fill, compact }: LeaderLabelProps) {
  if (value === 0) return null;
  const cos = Math.cos(-RADIAN * midAngle);
  const sin = Math.sin(-RADIAN * midAngle);
  const sx = cx + (outerRadius + 6) * cos;
  const sy = cy + (outerRadius + 6) * sin;

  const side: 'left' | 'right' = cos >= 0 ? 'right' : 'left';
  const dir = side === 'right' ? 1 : -1;

  // 굽는 지점은 기본적으로 조각의 실제 각도를 따라간다. 작은 조각일 때만 겹침 방지용 고정
  // 오프셋을 쓰고, 그 오프셋도 링 반지름 범위 안으로 clamp해 차트 밖으로 나가지 않게 한다.
  // 좁은 화면(compact)에서는 리드선을 짧게 그려 라벨이 카드 폭 안에 들어오게 한다.
  const bendRadius = outerRadius + (compact ? 12 : 22);
  const naturalEy = cy + bendRadius * sin;
  const maxOffset = outerRadius + (compact ? 18 : 30);
  const ey = percent < SMALL_SLICE_THRESHOLD && sliceKey in SMALL_SLICE_NUDGE
    ? cy + SMALL_SLICE_NUDGE[sliceKey] * (compact ? 0.75 : 1)
    : Math.min(cy + maxOffset, Math.max(cy - maxOffset, naturalEy));
  const ex = cx + dir * (outerRadius + (compact ? 24 : 44));
  const mx = ex - dir * (compact ? 8 : 14);
  const textAnchor = side === 'right' ? 'start' : 'end';
  const nameFontSize = compact ? 10 : 12;
  const detailFontSize = compact ? 9 : 11;

  return (
    <g>
      <path d={`M${sx},${sy} L${mx},${ey} L${ex},${ey}`} stroke={fill} strokeWidth={1.5} fill="none" />
      <circle cx={sx} cy={sy} r={2.5} fill={fill} />
      <text x={ex + dir * 4} y={ey - 3} textAnchor={textAnchor} fontSize={nameFontSize} fontWeight={600} fill="var(--color-foreground)">
        {name}
      </text>
      <text x={ex + dir * 4} y={ey + (compact ? 10 : 12)} textAnchor={textAnchor} fontSize={detailFontSize} fill="var(--color-muted-foreground)">
        {detail}
      </text>
    </g>
  );
}

export function RiskDistributionChart({ danger, warning, normal, unknown = 0 }: RiskDistributionChartProps) {
  const { m, locale } = useI18n();
  const t = m.dashboard.charts;
  const num = (v: number) => v.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US');
  const data = [
    { key: 'DANGER', name: t.riskDanger, value: danger, color: '#F52E7F' },
    { key: 'WARNING', name: t.riskWarning, value: warning, color: '#EAB308' },
    { key: 'NORMAL', name: t.riskNormal, value: normal, color: 'var(--color-foreground)' },
    { key: 'UNKNOWN', name: t.riskUnknown, value: unknown, color: 'var(--color-muted-foreground)' },
  ];
  const total = danger + warning + normal + unknown;
  const compact = useIsCompactChart();

  return (
    <div className="px-5 py-4">
      <h3 className="text-sm font-semibold">{t.riskTitle}</h3>
      <div className="mt-2 h-64">
        {total === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <PieChartIcon className="size-5 opacity-40" aria-hidden="true" />
            <p className="text-sm">{t.noData}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={compact ? { top: 24, right: 52, bottom: 24, left: 40 } : { top: 32, right: 96, bottom: 32, left: 72 }}>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={compact ? 40 : 52}
                outerRadius={compact ? 58 : 76}
                paddingAngle={3}
                stroke="var(--color-card)"
                strokeWidth={2}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                label={(props: any) => (
                  <LeaderLineLabel
                    cx={props.cx}
                    cy={props.cy}
                    midAngle={props.midAngle}
                    outerRadius={props.outerRadius}
                    value={props.value}
                    percent={props.percent}
                    name={props.name}
                    sliceKey={data[props.index].key}
                    detail={format(t.sliceLabel, { count: num(props.value), percent: Math.round(props.percent * 100) })}
                    fill={data[props.index].color}
                    compact={compact}
                  />
                )}
                labelLine={false}
                isAnimationActive={false}
              >
                {data.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Pie>
              <text x="50%" y="47%" textAnchor="middle" dominantBaseline="central" fontSize={22} fontWeight={700} fill="var(--color-foreground)">
                {formatNumber(total)}
              </text>
              <text x="50%" y="56%" textAnchor="middle" dominantBaseline="central" fontSize={11} fill="var(--color-muted-foreground)">
                {t.totalSku}
              </text>
              <Tooltip
                formatter={(value, name) => {
                  const v = Number(value);
                  return [format(t.sliceTooltip, { count: num(v), percent: Math.round((v / total) * 100) }), String(name)];
                }}
                contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
