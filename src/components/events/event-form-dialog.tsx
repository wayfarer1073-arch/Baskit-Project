'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateRangeCalendarInput, type DateRange } from '@/components/events/date-range-calendar-input';
import { EVENT_TYPE_OPTIONS, type EventTypeValue } from '@/lib/event-types';
import { formatKstDate, todayKstDateString } from '@/lib/date';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

interface SimilarScheduleCandidate {
  scheduleId: string;
  title: string;
  startDate: string;
  endDate: string;
}

export interface EditingEvent {
  id: string;
  eventType: EventTypeValue;
  quantity: number | null;
  title: string | null;
  note: string;
  eventDate: string;
  endDate: string | null;
}

interface EventFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
  skuId: string | null;
  skuLabel?: string;
  defaultQuantity?: number;
  defaultEventDate?: string;
  /** 넘기면 새로 만들지 않고 이 이벤트를 수정한다. */
  editingEvent?: EditingEvent | null;
  onCreated?: () => void;
}

export function EventFormDialog({ open, onOpenChange, warehouseId, skuId, skuLabel, defaultQuantity, defaultEventDate, editingEvent, onCreated }: EventFormDialogProps) {
  const { m } = useI18n();
  const t = m.work.event;
  const [eventType, setEventType] = useState<EventTypeValue>('ADJUSTMENT');
  const [quantity, setQuantity] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>({ start: todayKstDateString(), end: todayKstDateString() });
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<SimilarScheduleCandidate | null>(null);

  const isEditing = !!editingEvent;

  useEffect(() => {
    if (!open) return;
    if (editingEvent) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEventType(editingEvent.eventType);
      setQuantity(editingEvent.quantity !== null ? String(editingEvent.quantity) : '');
      setTitle(editingEvent.title ?? '');
      setNote(editingEvent.note);
      const start = formatKstDate(editingEvent.eventDate);
      setDateRange({ start, end: editingEvent.endDate ? formatKstDate(editingEvent.endDate) : start });
    } else {
      const day = defaultEventDate ?? todayKstDateString();
      setQuantity(defaultQuantity !== undefined ? String(defaultQuantity) : '');
      setDateRange({ start: day, end: day });
      setTitle('');
      setNote('');
      setEventType('ADJUSTMENT');
    }
    setConfirmation(null);
  }, [open, defaultQuantity, defaultEventDate, editingEvent]);

  async function submitEvent(extra?: { confirmChoice: 'use_existing' | 'create_new'; existingScheduleId?: string }) {
    const payload = {
      warehouseId,
      skuId,
      eventType,
      quantity: quantity === '' ? null : Number(quantity),
      note,
      eventDate: `${dateRange.start}T09:00:00`,
      endDate: dateRange.end !== dateRange.start ? `${dateRange.end}T09:00:00` : null,
      title: title.trim() || null,
      ...extra,
    };
    return isEditing
      ? fetch(`/api/events/${editingEvent.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }

  async function submit() {
    if (!note.trim()) {
      toast.error(t.noteRequired);
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitEvent();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? t.saveFailed);
        return;
      }
      if (body.needsConfirmation) {
        setConfirmation(body.candidate);
        return;
      }
      toast.success(isEditing ? t.updated : t.created);
      onOpenChange(false);
      onCreated?.();
    } catch {
      toast.error(t.saveFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function resolveConfirmation(choice: 'use_existing' | 'create_new') {
    if (!confirmation) return;
    setSubmitting(true);
    try {
      const res = await submitEvent({ confirmChoice: choice, existingScheduleId: choice === 'use_existing' ? confirmation.scheduleId : undefined });
      if (!res.ok) throw new Error();
      toast.success(isEditing ? t.updated : t.created);
      setConfirmation(null);
      onOpenChange(false);
      onCreated?.();
    } catch {
      toast.error(t.saveFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? t.titleEdit : t.titleNew}</DialogTitle>
          <DialogDescription>{skuLabel ? format(t.target, { name: skuLabel }) : t.wholeWarehouse}</DialogDescription>
        </DialogHeader>

        {confirmation ? (
          <div className="space-y-4">
            <p className="text-sm">
              {t.similarBefore} <span className="font-semibold">&apos;{confirmation.title}&apos;</span>
              {t.similarAfter}
            </p>
            <p className="text-xs text-muted-foreground">
              {format(t.similarHelp, { existing: confirmation.title, title: title.trim() })}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => resolveConfirmation('create_new')} disabled={submitting}>
                {t.newSchedule}
              </Button>
              <Button onClick={() => resolveConfirmation('use_existing')} disabled={submitting}>
                {t.joinSchedule}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t.memoOnly}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="event-type">{t.type}</Label>
                  <Select value={eventType} onValueChange={(v) => setEventType(v as EventTypeValue)}>
                    <SelectTrigger id="event-type" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EVENT_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{m.domain.eventTypes[o.value]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="event-quantity">{t.quantity}</Label>
                  <Input id="event-quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={t.quantityPlaceholder} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-title">{t.scheduleTitle}</Label>
                <Input
                  id="event-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t.scheduleTitlePlaceholder}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t.date}</Label>
                <DateRangeCalendarInput value={dateRange} onChange={setDateRange} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-note">{t.note}</Label>
                <Textarea id="event-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.notePlaceholder} rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t.cancel}</Button>
              <Button onClick={submit} disabled={submitting}>{submitting ? t.saving : isEditing ? t.update : t.save}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
