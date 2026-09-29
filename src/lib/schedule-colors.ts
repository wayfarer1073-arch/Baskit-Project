export const SCHEDULE_COLORS = ['red', 'orange', 'pink', 'lime', 'cyan', 'lavender'] as const;
export type ScheduleColor = (typeof SCHEDULE_COLORS)[number];

export function isScheduleColor(value: string): value is ScheduleColor {
  return (SCHEDULE_COLORS as readonly string[]).includes(value);
}

/** 캘린더 바/뱃지 배경+텍스트, 그리고 색상 선택용 스와치 배경. 리터럴 클래스명이라 Tailwind JIT가 그대로 인식한다. */
export const SCHEDULE_COLOR_CLASSNAMES: Record<ScheduleColor, { bar: string; swatch: string }> = {
  red: { bar: 'bg-red-200 text-red-900', swatch: 'bg-red-400' },
  orange: { bar: 'bg-orange-200 text-orange-900', swatch: 'bg-orange-400' },
  pink: { bar: 'bg-pink-200 text-pink-900', swatch: 'bg-pink-300' },
  lime: { bar: 'bg-lime-200 text-lime-900', swatch: 'bg-lime-400' },
  cyan: { bar: 'bg-cyan-200 text-cyan-900', swatch: 'bg-cyan-400' },
  lavender: { bar: 'bg-violet-200 text-violet-900', swatch: 'bg-violet-300' },
};

/** 제목 문자열로 안정적인(랜덤이 아닌) 기본 색상을 고른다 — 매번 같은 제목이 같은 기본색을 받는다. */
export function defaultScheduleColorFor(title: string): ScheduleColor {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash + title.charCodeAt(i)) % SCHEDULE_COLORS.length;
  return SCHEDULE_COLORS[hash];
}
