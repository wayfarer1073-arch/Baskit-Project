'use client';

import { useMemo, useState } from 'react';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, getDay, isSameMonth, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DayDetailDialog } from '@/components/upload/day-detail-dialog';
import { ScheduleDetailDialog } from '@/components/upload/schedule-detail-dialog';
import { todayKstDateString } from '@/lib/date';
import { SCHEDULE_COLOR_CLASSNAMES, type ScheduleColor } from '@/lib/schedule-colors';
import { assignScheduleLanes } from '@/domain/events/schedule-layout';
import type { ScheduleRow } from '@/domain/events/schedule-types';
import { cn } from '@/lib/utils';

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
}

interface UploadCalendarProps {
  warehouses: { id: string; code: string; name: string }[];
  entries: CalendarEntry[];
  holidays: { date: string; name: string }[];
  schedules: ScheduleRow[];
  isAdmin: boolean;
  /** 설정의 '휴무일 업로드' — 켜져 있으면 주말·휴무일도 업로드할 수 있다(칸은 여전히 휴무일로 표시). */
  allowNonWorkingDayUploads: boolean;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_LANES = 3;
const BAR_H = 15;
const BAR_GAP = 3;
const BARS_TOP_OFFSET = 28; // 셀 padding(8) + 날짜 줄 높이(16) + 여백(4)

function chunkIntoWeeks(days: Date[]): Date[][] {
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

export function UploadCalendar({ warehouses, entries, holidays, schedules, isAdmin, allowNonWorkingDayUploads }: UploadCalendarProps) {
  const [month, setMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [scheduleList, setScheduleList] = useState(schedules);
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
    setScheduleList((prev) => prev.map((s) => (s.id === scheduleId ? { ...s, color } : s)));
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between gap-3 bg-sidebar px-5 py-3.5 text-sidebar-foreground">
        <div className="flex items-center gap-1.5">
          <h2 className="text-base font-semibold">업로드 현황 캘린더</h2>
          <InfoTooltip className="text-lime-400 hover:text-lime-300">
            날짜 칸을 눌러 창고별로 재고 Excel을 업로드하거나 입고 특이사항을 기록하세요. 업로드가 끝난 창고는 날짜 옆에 작게 코드로 표시됩니다. 주말·공휴일(옅은 회색)은 업로드할
            수 없지만 KPI 계산에는 직전 영업일 자료가 그대로 포함됩니다. 색이 있는 막대는 SKU 상세에서 등록한 일정(메모/이벤트)이며, 눌러서 내용을 확인하거나 색상을 바꿀 수
            있습니다.
          </InfoTooltip>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="text-foreground hover:text-brand-accent" onClick={() => setMonth((m) => subMonths(m, 1))} aria-label="이전 달">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="w-24 text-center text-sm font-semibold tabular-nums">{format(month, 'yyyy년 M월')}</span>
          <Button variant="outline" size="icon" className="text-foreground hover:text-brand-accent" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="다음 달">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="border-t border-l border-border">
          <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((d) => (
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
                      const uploadedCodes = warehouses.filter((w) => entryByKey.has(`${w.id}|${dateStr}`)).map((w) => w.code);
                      return (
                        <button
                          key={dateStr}
                          type="button"
                          disabled={isFuture}
                          onClick={() => setSelectedDate(dateStr)}
                          className={cn(
                            'group flex aspect-[6/5] flex-col border-r border-b border-border p-2 text-left transition-colors',
                            inMonth ? 'bg-background' : 'bg-muted/30',
                            isBlocked && !isToday && 'bg-muted/60',
                            isToday && 'bg-foreground',
                            isFuture ? 'cursor-default' : isToday ? 'cursor-pointer hover:bg-lime-300' : 'cursor-pointer hover:bg-muted',
                          )}
                        >
                          <div className="flex h-4 items-start justify-between gap-1">
                            <div className="flex items-baseline gap-1">
                              <span
                                className={cn(
                                  'text-xs tabular-nums',
                                  inMonth ? 'text-foreground' : 'text-muted-foreground/60',
                                  isBlocked && !isToday && (inMonth ? 'text-status-danger' : 'text-status-danger/40'),
                                  isToday && 'font-semibold text-background group-hover:text-black',
                                )}
                              >
                                {format(day, 'd')}
                              </span>
                              {uploadedCodes.length > 0 && (
                                <span className={cn('text-[9px] font-semibold', isToday ? 'text-background/80 group-hover:text-black/70' : 'text-muted-foreground')}>
                                  {uploadedCodes.join(' ')}
                                </span>
                              )}
                            </div>
                            {holidayName && (
                              <span
                                className={cn(
                                  'truncate text-[9px] font-medium',
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
                            {seg.schedule.title} · {seg.schedule.events.length}건 · 눌러서 상세 보기
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
        <DayDetailDialog
          key={selectedDate}
          open
          onOpenChange={(open) => !open && setSelectedDate(null)}
          date={selectedDate}
          warehouses={warehouses}
          entryByWarehouseId={entryByWarehouseIdForSelectedDate}
          blocked={selectedDateBlocked}
          isAdmin={isAdmin}
        />
      )}

      <ScheduleDetailDialog schedule={openSchedule} onOpenChange={(open) => !open && setOpenScheduleId(null)} onColorChanged={handleColorChanged} />
    </section>
  );
}
