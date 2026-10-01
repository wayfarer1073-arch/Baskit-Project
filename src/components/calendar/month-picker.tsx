'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format as fill } from '@/lib/i18n/locales';

/** 캘린더에서 고를 수 있는 연도 범위 — 올해 기준 앞 4년 ~ 다음 해. 보고 있는 연도가 범위 밖이면 함께 넣는다. */
const YEARS_BACK = 4;
const YEARS_AHEAD = 1;

interface MonthPickerProps {
  year: number;
  /** 1~12 */
  month: number;
  todayYear: number;
  onChange: (year: number, month: number) => void;
}

/**
 * 캘린더 머리글의 연도·월 선택 상자. 월은 1~12월 순서대로 보여 주고, 월을 바꿔도 연도는 연도 상자의 값을 그대로 쓴다.
 */
export function MonthPicker({ year, month, todayYear, onChange }: MonthPickerProps) {
  const { m, locale } = useI18n();
  const t = m.calendar.picker;
  const years = Array.from({ length: YEARS_BACK + YEARS_AHEAD + 1 }, (_, i) => todayYear - YEARS_BACK + i);
  if (!years.includes(year)) years.push(year);
  years.sort((a, b) => a - b);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const monthName = (n: number) => (locale === 'ko' ? fill(t.monthOption, { month: n }) : new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(2000, n - 1, 1)));
  const trigger = 'h-8 border-0 bg-background text-sm font-semibold text-foreground tabular-nums shadow-none';

  return (
    <div className="flex items-center gap-1.5">
      <Select value={String(year)} onValueChange={(v) => onChange(Number(v), month)}>
        <SelectTrigger aria-label={t.yearLabel} className={`${trigger} w-[5.75rem]`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {fill(t.yearOption, { year: y })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={String(month)} onValueChange={(v) => onChange(year, Number(v))}>
        <SelectTrigger aria-label={t.monthLabel} className={`${trigger} w-[4.75rem]`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {months.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {monthName(n)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
