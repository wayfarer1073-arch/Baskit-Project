'use client';

import { useState } from 'react';
import { ArrowLeft, CalendarPlus, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DailyDayPanel, PeriodicDayPanel, StoreDayPanel, type WarehouseOption } from '@/components/calendar/day-panels';
import type { CalendarEntry } from '@/components/upload/upload-calendar';
import type { OrderEntryRow, StoreItemLearning } from '@/domain/segments/read-model';
import type { Segment } from '@/lib/segments';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { formatKstDate } from '@/lib/date';
import { formatMoney } from '@/lib/format';

export interface CalendarDayDialogProps {
  date: string;
  today: string;
  enabledSegments: Segment[];
  /** 모드를 하나만 쓰면 고르는 단계 없이 바로 그 입력 칸을 연다. */
  initialMode: Segment | null;
  warehouses: WarehouseOption[];
  entryByWarehouseId: Map<string, CalendarEntry>;
  /** 휴무일이고 '휴무일 업로드'가 꺼져 있음 — 재고 업로드·실사만 막힌다(매출은 항상 가능). */
  stockBlocked: boolean;
  isAdmin: boolean;
  canEdit: boolean;
  salesAmount: number | null;
  storeItems: StoreItemLearning[];
  orders: OrderEntryRow[];
  onClose: () => void;
  onChangeDate: (date: string, mode: Segment) => void;
  onAddSchedule: (date: string) => void;
}

/**
 * 날짜 칸을 누르면 뜨는 플로팅 패널(배경은 살짝 흐림). 먼저 어떤 기록을 할지(켜 둔 방식 중) 고르고,
 * 고른 방식의 업로드·입력 칸을 보여준다. 오른쪽 위 버튼으로 그날부터 시작하는 일정을 등록한다.
 */
export function CalendarDayDialog(props: CalendarDayDialogProps) {
  const { date, today, enabledSegments, warehouses, entryByWarehouseId, stockBlocked, isAdmin, canEdit } = props;
  const { m, locale } = useI18n();
  const t = m.calendar.panel;
  const single = enabledSegments.length === 1;
  const [mode, setMode] = useState<Segment | null>(single ? enabledSegments[0] : props.initialMode);
  const isFuture = date > today;

  const uploadedCodes = warehouses.filter((w) => entryByWarehouseId.has(w.id)).map((w) => w.code);
  const countedSkus = [...entryByWarehouseId.values()].reduce((sum, e) => sum + e.rowCount, 0);
  const status: Record<Segment, string> = {
    DAILY_SYNC: uploadedCodes.length ? format(t.uploadedWarehouses, { codes: uploadedCodes.join(' ') }) : t.notUploaded,
    PERIODIC_COUNT: countedSkus ? format(t.countedSkus, { count: countedSkus }) : t.notCounted,
    ORDER_CYCLE: props.salesAmount === null ? t.noSales : format(t.salesAmount, { amount: formatMoney(props.salesAmount, locale) }),
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="pr-40">
          <DialogTitle>{format(t.title, { date: formatKstDate(date) })}</DialogTitle>
          <DialogDescription>{mode ? m.segments[mode].label : t.chooseMode}</DialogDescription>
        </DialogHeader>
        <Button size="sm" variant="outline" className="absolute top-3 right-12 gap-1.5" onClick={() => props.onAddSchedule(date)}>
          <CalendarPlus className="size-4" aria-hidden="true" />
          {t.addSchedule}
        </Button>

        {mode === null ? (
          <div className="grid gap-2.5 sm:grid-cols-3">
            {enabledSegments.map((segment) => (
              <button
                key={segment}
                type="button"
                onClick={() => setMode(segment)}
                className="group flex flex-col gap-1 rounded-xl border border-border p-4 text-left transition-colors hover:border-brand-accent hover:bg-brand-accent/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                  {m.segments[segment].label}
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
                <span className="text-xs text-muted-foreground">{t.modeHints[segment]}</span>
                <span className="mt-2 text-xs font-medium text-foreground/80">{status[segment]}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {!single && (
              <button type="button" onClick={() => setMode(null)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                {t.back}
              </button>
            )}
            {isFuture ? (
              <p className="rounded-md bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">{t.future}</p>
            ) : mode === 'DAILY_SYNC' ? (
              <DailyDayPanel date={date} warehouses={warehouses} entryByWarehouseId={entryByWarehouseId} blocked={stockBlocked} isAdmin={isAdmin} />
            ) : mode === 'PERIODIC_COUNT' ? (
              <PeriodicDayPanel
                date={date}
                today={today}
                warehouses={warehouses}
                entryByWarehouseId={entryByWarehouseId}
                blocked={stockBlocked}
                isAdmin={isAdmin}
                canEdit={canEdit}
              />
            ) : (
              <StoreDayPanel
                date={date}
                today={today}
                salesAmount={props.salesAmount}
                items={props.storeItems}
                orders={props.orders}
                canEdit={canEdit}
                onNext={(next) => props.onChangeDate(next, 'ORDER_CYCLE')}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
