'use client';

import { useMemo, useState } from 'react';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, getDay, isSameMonth, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CalendarDayDialog } from '@/components/calendar/calendar-day-dialog';
import { ScheduleFormDialog } from '@/components/calendar/schedule-form-dialog';
import type { OrderEntryRow, SalesEntryRow, StoreItemLearning } from '@/domain/segments/read-model';
import type { Segment } from '@/lib/segments';
import { ScheduleDetailDialog } from '@/components/upload/schedule-detail-dialog';
import { todayKstDateString } from '@/lib/date';
import { SCHEDULE_COLOR_CLASSNAMES, type ScheduleColor } from '@/lib/schedule-colors';
import { assignScheduleLanes } from '@/domain/events/schedule-layout';
import type { ScheduleRow } from '@/domain/events/schedule-types';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format as fill } from '@/lib/i18n/locales';
import type { WarehouseOption } from '@/components/calendar/day-panels';

export interface CalendarEntry {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  date: string; // yyyy-MM-dd
  rowCount: number;
  uploadedByName: string;
  uploadedAt: string;
  inboundCount: number;
  snapshotId: string;
  /** 보관된 원본 파일(없으면 null — 기능 도입 전 업로드 등). */
  sourceFile: { fileName: string; size: number } | null;
  /** 실사 입력 화면에서 직접 적은 수량인지(엑셀 업로드가 아닌). */
  isManual: boolean;
}

interface UploadCalendarProps {
  warehouses: WarehouseOption[];
  entries: CalendarEntry[];
  holidays: { date: string; name: string }[];
  schedules: ScheduleRow[];
  isAdmin: boolean;
  /** 설정의 '휴무일 업로드' — 켜져 있으면 주말·휴무일도 업로드할 수 있다(칸은 여전히 휴무일로 표시). */
  allowNonWorkingDayUploads: boolean;
  /** 설정에서 켜 둔 방식 — 날짜 칸 표시와 패널의 입력 선택지가 이것만 보인다. */
  enabledSegments: Segment[];
  /** 지금 보고 있는 대시보드 방식 — 여러 방식을 쓸 때도 패널을 열면 고르는 화면부터 보여준다. */
  activeSegment: Segment;
  canEdit: boolean;
  sales: SalesEntryRow[];
  orders: OrderEntryRow[];
  storeItems: StoreItemLearning[];
  /** 주소로 받은 열 날짜(예전 실사 입력·발주 기록 주소에서 넘어올 때). */
  initialDate?: string | null;
  initialMode?: Segment | null;
  todos: CalendarTodo[];
}

export interface CalendarTodo {
  kind: 'dailyMissing' | 'periodicRecount' | 'storeMissing';
  count: number;
  /** 누르면 열 날짜(매출은 가장 오래된 미입력일부터). */
  date: string;
  mode: Segment;
}

/** 매출을 칸에 짧게 — 한국어는 만/억, 영어는 K/M. */
function compactAmount(value: number, locale: string) {
  if (locale !== 'ko') return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  if (value >= 100_000_000) return `${Math.round(value / 10_000_000) / 10}억`;
  if (value >= 10_000) return `${Math.round(value / 1_000) / 10}만`;
  return value.toLocaleString('ko-KR');
}

const MAX_LANES = 3;
const BAR_H = 15;
const BAR_GAP = 3;
const BARS_TOP_OFFSET = 28; // 셀 padding(8) + 날짜 줄 높이(16) + 여백(4)

function chunkIntoWeeks(days: Date[]): Date[][] {
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

export function UploadCalendar({
  warehouses,
  entries,
  holidays,
  schedules,
  isAdmin,
  allowNonWorkingDayUploads,
  enabledSegments,
  canEdit,
  sales,
  orders,
  storeItems,
  initialDate,
  initialMode,
  todos,
}: UploadCalendarProps) {
  const { m, locale } = useI18n();
  const t = m.work;
  const c = m.calendar;
  const [month, setMonth] = useState(() => (initialDate ? new Date(`${initialDate}T00:00:00`) : new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate ?? null);
  const [selectedMode, setSelectedMode] = useState<Segment | null>(initialMode ?? null);
  const [scheduleForm, setScheduleForm] = useState<{ schedule: ScheduleRow | null; date: string } | null>(null);
  const showDaily = enabledSegments.includes('DAILY_SYNC');
  const showPeriodic = enabledSegments.includes('PERIODIC_COUNT');
  const showStore = enabledSegments.includes('ORDER_CYCLE');
  const salesByDate = useMemo(() => new Map(sales.map((s) => [s.date, s.amount])), [sales]);
  const dailyWarehouses = useMemo(() => warehouses.filter((w) => w.segment === 'DAILY_SYNC'), [warehouses]);
  // 비정기 실사 표시는 비정기 실사 창고의 기록만 센다(일일 업로드 창고의 파일과 섞이지 않게).
  const skusByDate = useMemo(() => {
    const periodicIds = new Set(warehouses.filter((w) => w.segment === 'PERIODIC_COUNT').map((w) => w.id));
    const map = new Map<string, number>();
    for (const e of entries) if (periodicIds.has(e.warehouseId)) map.set(e.date, (map.get(e.date) ?? 0) + e.rowCount);
    return map;
  }, [entries, warehouses]);
  const [colorOverrides, setColorOverrides] = useState<Record<string, ScheduleColor>>({});
  // 저장 후 새로고침되면 서버가 준 최신 일정을 그대로 쓰고, 색상만 바로 반영되도록 덧씌운다.
  const scheduleList = useMemo(() => schedules.map((s) => (colorOverrides[s.id] ? { ...s, color: colorOverrides[s.id] } : s)), [schedules, colorOverrides]);
  const [openScheduleId, setOpenScheduleId] = useState<string | null>(null);

  const today = todayKstDateString();

  const entryByKey = useMemo(() => {
    const map = new Map<string, CalendarEntry>();
    for (const entry of entries) {
      map.set(`${entry.warehouseId}|${entry.date}`, entry);
    }
    return map;
  }, [entries]);

  const entryByWarehouseIdForSelectedDate = useMemo(() => {
    const map = new Map<string, CalendarEntry>();
    if (!selectedDate) return map;
    for (const w of warehouses) {
      const entry = entryByKey.get(`${w.id}|${selectedDate}`);
      if (entry) map.set(w.id, entry);
    }
    return map;
  }, [entryByKey, warehouses, selectedDate]);

  const holidayByDate = useMemo(() => new Map(holidays.map((h) => [h.date, h.name])), [holidays]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [month]);

  const weeks = useMemo(() => chunkIntoWeeks(days), [days]);

  const monthStart = format(days[0], 'yyyy-MM-dd');
  const monthEnd = format(days[days.length - 1], 'yyyy-MM-dd');

  const monthSchedules = useMemo(() => scheduleList.filter((s) => s.endDate >= monthStart && s.startDate <= monthEnd), [scheduleList, monthStart, monthEnd]);
  const laneOf = useMemo(() => assignScheduleLanes(monthSchedules), [monthSchedules]);
  const lanesUsed = useMemo(() => {
    let max = -1;
    for (const s of monthSchedules) max = Math.max(max, laneOf.get(s.id) ?? -1);
    return Math.min(MAX_LANES, max + 1);
  }, [monthSchedules, laneOf]);
  const barsSpacerHeight = lanesUsed > 0 ? lanesUsed * BAR_H + (lanesUsed - 1) * BAR_GAP : 0;

  const openSchedule = scheduleList.find((s) => s.id === openScheduleId) ?? null;
  const selectedDateBlocked =
    !allowNonWorkingDayUploads && selectedDate
      ? getDay(new Date(`${selectedDate}T00:00:00`)) === 0 || getDay(new Date(`${selectedDate}T00:00:00`)) === 6 || holidayByDate.has(selectedDate)
      : false;

  function handleColorChanged(scheduleId: string, color: ScheduleColor) {
    setColorOverrides((prev) => ({ ...prev, [scheduleId]: color }));
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between gap-3 bg-sidebar px-5 py-3.5 text-sidebar-foreground">
        <div className="flex items-center gap-1.5">
          <h2 className="text-base font-semibold">{c.title}</h2>
          <InfoTooltip tone="header">{c.description}</InfoTooltip>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="text-foreground hover:text-brand-accent" onClick={() => setMonth((m) => subMonths(m, 1))} aria-label={t.calendar.prevMonth}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="w-24 text-center text-sm font-semibold tabular-nums">{format(month, t.calendar.monthFormat)}</span>
          <Button variant="outline" size="icon" className="text-foreground hover:text-brand-accent" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label={t.calendar.nextMonth}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2" role="list" aria-label={c.todo.title}>
          <span className="text-xs font-semibold text-muted-foreground">{c.todo.title}</span>
          {todos.length === 0 && <span className="text-xs text-muted-foreground">{c.todo.allDone}</span>}
          {todos.map((todo) => (
            <button
              key={todo.kind}
              type="button"
              role="listitem"
              onClick={() => {
                setMonth(new Date(`${todo.date}T00:00:00`));
                setSelectedMode(todo.mode);
                setSelectedDate(todo.date);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-status-warning/40 bg-status-warning-bg px-3 py-1 text-xs font-medium text-status-warning transition-colors hover:border-status-warning"
            >
              <span className="size-1.5 rounded-full bg-status-warning" aria-hidden="true" />
              {fill(c.todo[todo.kind], { count: todo.count })}
              <span className="text-status-warning/70">· {m.segments[todo.mode].label}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-l border-border">
          <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">
            {t.calendar.weekdays.map((d) => (
              <div key={d} className="border-r border-b border-border py-1">
                {d}
              </div>
            ))}
          </div>
          <div>
            {weeks.map((week) => {
              const weekStart = format(week[0], 'yyyy-MM-dd');
              const weekEnd = format(week[6], 'yyyy-MM-dd');
              const segments = monthSchedules
                .map((s) => {
                  const lane = laneOf.get(s.id) ?? 0;
                  if (lane >= MAX_LANES) return null;
                  if (s.endDate < weekStart || s.startDate > weekEnd) return null;
                  const segStart = s.startDate > weekStart ? s.startDate : weekStart;
                  const segEnd = s.endDate < weekEnd ? s.endDate : weekEnd;
                  const colStart = week.findIndex((d) => format(d, 'yyyy-MM-dd') === segStart);
                  const colEnd = week.findIndex((d) => format(d, 'yyyy-MM-dd') === segEnd);
                  if (colStart === -1 || colEnd === -1) return null;
                  return {
                    schedule: s,
                    lane,
                    colStart,
                    colSpan: colEnd - colStart + 1,
                    isTrueStart: segStart === s.startDate,
                    isTrueEnd: segEnd === s.endDate,
                  };
                })
                .filter((v): v is NonNullable<typeof v> => v !== null);

              return (
                <div key={weekStart} className="relative">
                  <div className="grid grid-cols-7">
                    {week.map((day) => {
                      const dateStr = format(day, 'yyyy-MM-dd');
                      const inMonth = isSameMonth(day, month);
                      const isToday = dateStr === today;
                      const isFuture = dateStr > today;
                      const holidayName = holidayByDate.get(dateStr);
                      const isWeekendDay = getDay(day) === 0 || getDay(day) === 6;
                      const isBlocked = isWeekendDay || holidayName !== undefined;
                      const uploadedCodes = showDaily ? dailyWarehouses.filter((w) => entryByKey.has(`${w.id}|${dateStr}`)).map((w) => w.code) : [];
                      const countedSkus = showPeriodic ? (skusByDate.get(dateStr) ?? 0) : 0;
                      const salesAmount = showStore ? salesByDate.get(dateStr) : undefined;
                      const markerTone = isToday ? 'text-background/80 group-hover:text-black/70' : 'text-muted-foreground';
                      const markers = [
                        uploadedCodes.join(' '),
                        countedSkus > 0 ? fill(c.markers.skus, { count: countedSkus.toLocaleString() }) : '',
                        salesAmount !== undefined ? fill(c.markers.sales, { amount: compactAmount(salesAmount, locale) }) : '',
                      ].filter(Boolean);
                      return (
                        <button
                          key={dateStr}
                          type="button"
                          onClick={() => {
                            setSelectedMode(null);
                            setSelectedDate(dateStr);
                          }}
                          className={cn(
                            'group flex aspect-[6/5] flex-col border-r border-b border-border p-2 text-left transition-colors',
                            inMonth ? 'bg-background' : 'bg-muted/30',
                            isBlocked && !isToday && 'bg-muted/60',
                            isToday && 'bg-foreground',
                            isToday ? 'cursor-pointer hover:bg-lime-300' : isFuture ? 'cursor-pointer hover:bg-muted/40' : 'cursor-pointer hover:bg-muted',
                          )}
                        >
                          <div className="flex h-4 items-start justify-between gap-1">
                            <div className="flex min-w-0 items-baseline gap-1">
                              <span
                                className={cn(
                                  'shrink-0 text-xs tabular-nums',
                                  inMonth ? 'text-foreground' : 'text-muted-foreground/60',
                                  isBlocked && !isToday && (inMonth ? 'text-status-danger' : 'text-status-danger/40'),
                                  isToday && 'font-semibold text-background group-hover:text-black',
                                )}
                              >
                                {format(day, 'd')}
                              </span>
                              {/* 날짜 바로 옆 한 줄에 일일 업로드 / 비정기 실사 / 매장 매출 순으로 — 시선이 위아래로 흩어지지 않게. */}
                              {markers.length > 0 && (
                                <span className={cn('min-w-0 truncate text-[10px] font-semibold tabular-nums', markerTone)} title={markers.join(' / ')}>
                                  {markers.map((marker, i) => (
                                    <span key={i}>
                                      {i > 0 && <span className="px-0.5 font-normal opacity-60">/</span>}
                                      {marker}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </div>
                            {holidayName && (
                              <span
                                className={cn(
                                  'max-w-[45%] shrink-0 truncate text-[9px] font-medium',
                                  isToday ? 'text-background/80 group-hover:text-black/70' : inMonth ? 'text-status-danger' : 'text-status-danger/40',
                                )}
                              >
                                {holidayName}
                              </span>
                            )}
                          </div>
                          {barsSpacerHeight > 0 && <div style={{ height: barsSpacerHeight }} aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>

                  {segments.length > 0 && (
                    <div
                      className="pointer-events-none absolute inset-x-0"
                      style={{
                        top: BARS_TOP_OFFSET,
                        display: 'grid',
                        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                        columnGap: '0px',
                        rowGap: `${BAR_GAP}px`,
                      }}
                    >
                      {segments.map((seg) => (
                        <Tooltip key={seg.schedule.id}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setOpenScheduleId(seg.schedule.id)}
                              style={{
                                gridColumn: `${seg.colStart + 1} / span ${seg.colSpan}`,
                                gridRow: seg.lane + 1,
                                height: BAR_H,
                              }}
                              className={cn(
                                'pointer-events-auto truncate px-1.5 text-left text-[10px] font-medium leading-[15px] transition-opacity hover:opacity-80',
                                SCHEDULE_COLOR_CLASSNAMES[seg.schedule.color as ScheduleColor]?.bar ?? SCHEDULE_COLOR_CLASSNAMES.red.bar,
                              )}
                            >
                              {seg.schedule.title}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {fill(t.upload.scheduleBar, { title: seg.schedule.title, count: seg.schedule.events.length })}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedDate && (
        <CalendarDayDialog
          key={`${selectedDate}|${selectedMode ?? ''}`}
          date={selectedDate}
          today={today}
          enabledSegments={enabledSegments}
          initialMode={selectedMode}
          warehouses={warehouses}
          entryByWarehouseId={entryByWarehouseIdForSelectedDate}
          stockBlocked={selectedDateBlocked}
          isAdmin={isAdmin}
          canEdit={canEdit}
          salesAmount={salesByDate.get(selectedDate) ?? null}
          storeItems={storeItems}
          orders={orders}
          onClose={() => setSelectedDate(null)}
          onChangeDate={(date, mode) => {
            setMonth(new Date(`${date}T00:00:00`));
            setSelectedMode(mode);
            setSelectedDate(date);
          }}
          onAddSchedule={(date) => {
            setSelectedDate(null);
            setScheduleForm({ schedule: null, date });
          }}
        />
      )}

      <ScheduleDetailDialog
        schedule={openSchedule}
        onOpenChange={(open) => !open && setOpenScheduleId(null)}
        onColorChanged={handleColorChanged}
        onEdit={
          canEdit
            ? (schedule) => {
                setOpenScheduleId(null);
                setScheduleForm({ schedule, date: schedule.startDate });
              }
            : undefined
        }
      />
      {scheduleForm && (
        <ScheduleFormDialog
          key={scheduleForm.schedule?.id ?? `new-${scheduleForm.date}`}
          schedule={scheduleForm.schedule}
          defaultDate={scheduleForm.date}
          enabledSegments={enabledSegments}
          canEdit={canEdit}
          onClose={() => setScheduleForm(null)}
        />
      )}
    </section>
  );
}
