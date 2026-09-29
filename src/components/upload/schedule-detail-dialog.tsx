'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { formatKstDate } from '@/lib/date';
import { eventTypeText } from '@/lib/event-types';
import { SCHEDULE_COLORS, SCHEDULE_COLOR_CLASSNAMES, type ScheduleColor } from '@/lib/schedule-colors';
import { cn } from '@/lib/utils';
import type { ScheduleRow } from '@/domain/events/schedule-types';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

interface ScheduleDetailDialogProps {
  schedule: ScheduleRow | null;
  onOpenChange: (open: boolean) => void;
  onColorChanged: (scheduleId: string, color: ScheduleColor) => void;
}

export function ScheduleDetailDialog({ schedule, onOpenChange, onColorChanged }: ScheduleDetailDialogProps) {
  const { m } = useI18n();
  const t = m.work.schedule;
  const [savingColor, setSavingColor] = useState<ScheduleColor | null>(null);

  if (!schedule) return null;

  const dateLabel = schedule.startDate === schedule.endDate
    ? formatKstDate(schedule.startDate)
    : `${formatKstDate(schedule.startDate)} ~ ${formatKstDate(schedule.endDate)}`;

  async function changeColor(color: ScheduleColor) {
    if (!schedule || color === schedule.color) return;
    setSavingColor(color);
    try {
      const res = await fetch(`/api/schedules/${schedule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color }),
      });
      if (!res.ok) throw new Error();
      onColorChanged(schedule.id, color);
    } catch {
      toast.error(t.colorFailed);
    } finally {
      setSavingColor(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{eventTypeText(schedule.eventType, m.domain.eventTypes)}</Badge>
            <DialogTitle>{schedule.title}</DialogTitle>
          </div>
          <DialogDescription>{dateLabel}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">{t.color}</p>
            <div className="flex flex-wrap gap-2">
              {SCHEDULE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => changeColor(c)}
                  disabled={savingColor !== null}
                  aria-label={format(t.colorAria, { color: t.colors[c] })}
                  aria-pressed={schedule.color === c}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full ring-1 ring-border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                    SCHEDULE_COLOR_CLASSNAMES[c].swatch,
                  )}
                >
                  {schedule.color === c && <Check className="size-4 text-foreground/70" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">{format(t.memos, { count: schedule.events.length })}</p>
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {schedule.events.map((e) => (
                <div key={e.id} className="rounded-md border px-2.5 py-2 text-sm">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="shrink-0 text-[11px]">{e.warehouseCode}</Badge>
                    <span className="truncate font-medium">{e.productName ?? t.wholeWarehouse}</span>
                    {e.productCode && <span className="shrink-0 text-xs text-muted-foreground">{e.productCode}</span>}
                    {e.quantity !== null && <span className="shrink-0 text-xs text-muted-foreground">{format(t.quantity, { count: e.quantity })}</span>}
                  </div>
                  {e.note && <p className="mt-1 text-xs text-muted-foreground">{e.note}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
