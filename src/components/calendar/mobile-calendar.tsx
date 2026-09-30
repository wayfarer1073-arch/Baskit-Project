'use client';

import { useRef } from 'react';
import { format, getDay, isSameMonth } from 'date-fns';
import { CalendarPlus, Check, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WarehouseOption } from '@/components/calendar/day-panels';
import type { ScheduleRow } from '@/domain/events/schedule-types';
import type { Segment } from '@/lib/segments';
import { SCHEDULE_COLOR_CLASSNAMES, type ScheduleColor } from '@/lib/schedule-colors';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format as fill } from '@/lib/i18n/locales';

/** 모바일 칸의 점 색 — 방식마다 하나. 범례와 같은 값을 쓴다. */
const DOT: Record<Segment, string> = { DAILY_SYNC: 'bg-foreground', PERIODIC_COUNT: 'bg-sky-500', ORDER_CYCLE: 'bg-amber-500' };
const SWIPE_MIN_PX = 50;
/** 날짜 칸 아래에 보이는 일정 막대 수. 더 많으면 마지막 막대에 '외 n건'을 적는다. */
const MAX_BARS = 2;

export interface MobileCalendarProps {
  weeks: Date[][];
  month: Date;
  today: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  enabledSegments: Segment[];
  holidayByDate: Map<string, string>;
  dailyWarehouses: WarehouseOption[];
  /** 그날 업로드한 일일 창고 id. */
  hasDailyEntry: (warehouseId: string, date: string) => boolean;
  periodicCodesByDate: Map<string, string[]>;
  periodicSkusByDate: Map<string, number>;
  salesByDate: Map<string, number>;
  orderCountByDate: Map<string, number>;
  schedules: ScheduleRow[];
  /** 방식을 주면 그 방식의 입력 화면을 바로 연다. */
  onOpen: (date: string, mode: Segment) => void;
  onOpenSchedule: (id: string) => void;
  onAddSchedule: (date: string) => void;
}

/**
 * 좁은 화면용 캘린더 — 칸에는 날짜와 방식별 점만 두고, 고른 날짜의 기록은 달력 아래 목록으로 보여 준다.
 * 목록의 줄을 누르면 그 방식의 입력 화면이 바로 열린다. 달력을 좌우로 밀면 달이 바뀐다.
 */
export function MobileCalendar(props: MobileCalendarProps) {
  const { weeks, month, today, selectedDate, enabledSegments, holidayByDate, dailyWarehouses } = props;
  const { m, locale } = useI18n();
  const t = m.work.calendar;
  const c = m.calendar;
  const touch = useRef<{ x: number; y: number } | null>(null);
  const show = (s: Segment) => enabledSegments.includes(s);

  const schedulesOn = (date: string) => props.schedules.filter((s) => s.startDate <= date && s.endDate >= date);
  const dailyUploaded = (date: string) => dailyWarehouses.filter((w) => props.hasDailyEntry(w.id, date));

  const selected = new Date(`${selectedDate}T00:00:00`);
  const selectedHoliday = holidayByDate.get(selectedDate);
  const selectedIsFuture = selectedDate > today;
  const uploadedIds = new Set(dailyUploaded(selectedDate).map((w) => w.id));
  const periodicCodes = props.periodicCodesByDate.get(selectedDate) ?? [];
  const periodicSkus = props.periodicSkusByDate.get(selectedDate) ?? 0;
  const sales = props.salesByDate.get(selectedDate);
  const orderCount = props.orderCountByDate.get(selectedDate) ?? 0;

  return (
    <div>
      <div
        className="touch-pan-y select-none"
        onTouchStart={(e) => {
          touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchEnd={(e) => {
          const start = touch.current;
          touch.current = null;
          if (!start) return;
          const dx = e.changedTouches[0].clientX - start.x;
          const dy = e.changedTouches[0].clientY - start.y;
          if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy)) return;
          if (dx < 0) props.onNextMonth();
          else props.onPrevMonth();
        }}
      >
        <div className="grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground">
          {t.weekdays.map((d, i) => (
            <div key={d} className={cn('py-1.5', (i === 0 || i === 6) && 'text-status-danger/80')}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 border-t border-l border-border/60">
          {weeks.flat().map((day) => {
            const date = format(day, 'yyyy-MM-dd');
            const inMonth = isSameMonth(day, month);
            const isToday = date === today;
            const isSelected = date === selectedDate;
            const offDay = getDay(day) === 0 || getDay(day) === 6 || holidayByDate.has(date);
            const uploaded = show('DAILY_SYNC') && dailyWarehouses.length > 0 ? dailyUploaded(date).length : 0;
            // 일일 업로드: 모든 창고 = 원, 일부만 = 세모. 비정기 실사·매장 매출은 기록이 있으면 원.
            const marks = [
              uploaded > 0 && { key: 'daily', color: DOT.DAILY_SYNC, triangle: uploaded < dailyWarehouses.length },
              show('PERIODIC_COUNT') && props.periodicCodesByDate.has(date) && { key: 'periodic', color: DOT.PERIODIC_COUNT, triangle: false },
              show('ORDER_CYCLE') && props.salesByDate.has(date) && { key: 'store', color: DOT.ORDER_CYCLE, triangle: false },
            ].filter((d): d is { key: string; color: string; triangle: boolean } => !!d);
            const daySchedules = schedulesOn(date);
            const bars = daySchedules.slice(0, MAX_BARS);
            const more = daySchedules.length - MAX_BARS;
            return (
              <button
                key={date}
                type="button"
                onClick={() => props.onSelectDate(date)}
                aria-pressed={isSelected}
                aria-label={format(day, 'yyyy-MM-dd')}
                className={cn('relative flex min-h-14 flex-col items-center border-r border-b border-border/60 pt-1', !inMonth && 'bg-muted/30')}
              >
                {marks.length > 0 && (
                  <span className={cn('absolute top-1 left-1 flex flex-col items-center gap-[2px]', !inMonth && 'opacity-40')} aria-hidden="true">
                    {marks.map((mk) => (
                      <span key={mk.key} className={cn(mk.color, mk.triangle ? 'h-[5px] w-[6px] [clip-path:polygon(50%_0,100%_100%,0_100%)]' : 'size-[5px] rounded-full')} />
                    ))}
                  </span>
                )}
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full text-[13px] tabular-nums transition-colors',
                    !inMonth && 'text-muted-foreground/40',
                    inMonth && offDay && 'text-status-danger',
                    isToday && 'bg-foreground font-semibold text-background',
                    isSelected && !isToday && 'bg-brand-accent font-semibold text-black',
                    isSelected && isToday && 'ring-2 ring-brand-accent ring-offset-1 ring-offset-background',
                  )}
                >
                  {format(day, 'd')}
                </span>
                {bars.length > 0 && (
                  <span className={cn('mt-auto flex w-full flex-col gap-[2px] px-[3px] pb-1', !inMonth && 'opacity-40')} aria-hidden="true">
                    {bars.map((s, i) => {
                      const color = SCHEDULE_COLOR_CLASSNAMES[s.color as ScheduleColor] ?? SCHEDULE_COLOR_CLASSNAMES.red;
                      // 일정이 둘보다 많으면 두 번째 막대에 '외 n건'을 작게 적는다.
                      return i === MAX_BARS - 1 && more > 0 ? (
                        <span key={s.id} className={cn('flex h-[10px] items-center justify-center rounded-sm text-[8px] leading-none font-medium whitespace-nowrap', color.bar)}>
                          {fill(c.mobile.moreEvents, { count: more })}
                        </span>
                      ) : (
                        <span key={s.id} className={cn('h-[3px] rounded-full', color.swatch)} />
                      );
                    })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-hidden="true">
          {show('DAILY_SYNC') && (
            <>
              <span className="inline-flex items-center gap-1">
                <span className={cn('size-[5px] rounded-full', DOT.DAILY_SYNC)} />
                {c.mobile.dailyAll}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className={cn('h-[5px] w-[6px] [clip-path:polygon(50%_0,100%_100%,0_100%)]', DOT.DAILY_SYNC)} />
                {c.mobile.dailyPartial}
              </span>
            </>
          )}
          {enabledSegments
            .filter((s) => s !== 'DAILY_SYNC')
            .map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className={cn('size-[5px] rounded-full', DOT[s])} />
                {c.mobile.legend[s]}
              </span>
            ))}
        </div>
      </div>

      <section className="mt-4 rounded-xl border border-border" aria-label={c.mobile.dayListLabel}>
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{fill(c.mobile.dayTitle, { month: format(selected, 'M'), day: format(selected, 'd'), weekday: t.weekdays[getDay(selected)] })}</p>
            {selectedHoliday && <p className="truncate text-xs text-status-danger">{selectedHoliday}</p>}
          </div>
          <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => props.onAddSchedule(selectedDate)}>
            <CalendarPlus className="size-4" aria-hidden="true" />
            {c.panel.addSchedule}
          </Button>
        </div>
        <ul className="divide-y divide-border">
          {show('DAILY_SYNC') && (
            <AgendaRow dot={DOT.DAILY_SYNC} label={m.segments.DAILY_SYNC.label} onClick={() => props.onOpen(selectedDate, 'DAILY_SYNC')}>
              {dailyWarehouses.length === 0 ? (
                <span className="text-muted-foreground">{c.mobile.noWarehouse}</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {dailyWarehouses.map((w) => (
                    <span
                      key={w.id}
                      className={cn(
                        'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium',
                        uploadedIds.has(w.id) ? 'bg-status-normal-bg text-status-normal' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {w.code}
                      {uploadedIds.has(w.id) ? <Check className="size-3" aria-label={c.mobile.uploaded} /> : <span className="font-normal">· {c.mobile.missing}</span>}
                    </span>
                  ))}
                </span>
              )}
            </AgendaRow>
          )}
          {show('PERIODIC_COUNT') && (
            <AgendaRow dot={DOT.PERIODIC_COUNT} label={m.segments.PERIODIC_COUNT.label} onClick={() => props.onOpen(selectedDate, 'PERIODIC_COUNT')}>
              {periodicCodes.length ? (
                <span>
                  <span className="font-medium">{periodicCodes.join(' ')}</span>
                  <span className="text-muted-foreground"> · {fill(c.markers.skus, { count: periodicSkus.toLocaleString() })}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">{c.panel.notCounted}</span>
              )}
            </AgendaRow>
          )}
          {show('ORDER_CYCLE') && (
            <AgendaRow dot={DOT.ORDER_CYCLE} label={m.segments.ORDER_CYCLE.label} onClick={() => props.onOpen(selectedDate, 'ORDER_CYCLE')}>
              <span>
                {sales === undefined ? <span className="text-muted-foreground">{c.panel.noSales}</span> : fill(c.panel.salesAmount, { amount: formatMoney(sales, locale) })}
                {orderCount > 0 && <span className="text-muted-foreground"> · {fill(c.markers.orders, { count: orderCount })}</span>}
              </span>
            </AgendaRow>
          )}
          {schedulesOn(selectedDate).map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => props.onOpenSchedule(s.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted">
                <span
                  className={cn('h-8 w-1 shrink-0 rounded-full', SCHEDULE_COLOR_CLASSNAMES[s.color as ScheduleColor]?.swatch ?? SCHEDULE_COLOR_CLASSNAMES.red.swatch)}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.title}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">{s.startDate === s.endDate ? s.startDate : `${s.startDate} ~ ${s.endDate}`}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {selectedIsFuture && <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">{c.panel.future}</p>}
      </section>
    </div>
  );
}

function AgendaRow({ dot, label, onClick, children }: { dot: string; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted">
        <span className={cn('size-2 shrink-0 rounded-full', dot)} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted-foreground">{label}</span>
          <span className="mt-0.5 block text-sm">{children}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  );
}
