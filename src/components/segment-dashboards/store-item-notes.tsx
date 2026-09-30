'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Pencil, Plus, Trash2, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Paged } from '@/components/ui/paged';
import { DateRangeCalendarInput, type DateRange } from '@/components/events/date-range-calendar-input';
import { EVENT_TYPE_OPTIONS, eventTypeText, type EventTypeValue } from '@/lib/event-types';
import { todayKstDateString } from '@/lib/date';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

interface NoteRow {
  kind: 'memo' | 'schedule';
  id: string;
  eventType: EventTypeValue;
  title: string | null;
  note: string;
  startDate: string;
  endDate: string;
  authorName: string | null;
}

/**
 * 매장 품목의 메모/이벤트. 제목을 적으면 캘린더 일정이 되고(같은 일정의 다른 품목·SKU와 함께 보임), 비우면 이 품목에만 남는 메모다.
 * 캘린더에서 이 품목을 넣은 일정도 여기 나오고, 여기서 고치면 캘린더 일정이 바뀐다.
 */
export function StoreItemNotes({ itemId, itemName }: { itemId: string; itemName: string }) {
  const { m } = useI18n();
  const t = m.store.notes;
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [editing, setEditing] = useState<NoteRow | 'new' | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/store/items/${itemId}/notes`);
    if (res.ok) setNotes((await res.json()).notes);
  }, [itemId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function remove(row: NoteRow) {
    if (!confirm(row.kind === 'schedule' ? format(t.unlinkConfirm, { title: row.title ?? '' }) : t.deleteConfirm)) return;
    const res = await fetch(`/api/store/items/${itemId}/notes/${row.id}${row.kind === 'schedule' ? '?kind=schedule' : ''}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success(t.deleted);
      load();
    } else toast.error(t.failed);
  }

  return (
    <section aria-label={t.title}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t.title}</h3>
        <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
          <Plus className="size-3.5" /> {t.add}
        </Button>
      </div>
      {notes.length === 0 && <p className="text-sm text-muted-foreground">{t.empty}</p>}
      <Paged items={notes} pagerClassName="mt-2">
        {(pageItems) => (
          <div className="space-y-2">
            {pageItems.map((n) => (
              <div key={`${n.kind}-${n.id}`} className="rounded-md border p-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="outline" className="shrink-0">
                      {eventTypeText(n.eventType, m.domain.eventTypes)}
                    </Badge>
                    {n.kind === 'schedule' && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                        <CalendarDays className="size-3" aria-hidden="true" />
                        {t.calendar}
                      </span>
                    )}
                    {n.title && <span className="truncate font-semibold">{n.title}</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    {n.endDate !== n.startDate ? `${n.startDate} ~ ${n.endDate}` : n.startDate}
                    <button type="button" onClick={() => setEditing(n)} className="rounded-md p-1.5 transition-colors hover:bg-muted" aria-label={t.edit}>
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(n)}
                      className="rounded-md p-1.5 transition-colors hover:bg-destructive/10 hover:text-destructive"
                      aria-label={n.kind === 'schedule' ? t.unlink : t.delete}
                    >
                      {n.kind === 'schedule' ? <Unlink className="size-3.5" /> : <Trash2 className="size-3.5" />}
                    </button>
                  </div>
                </div>
                {n.note && <p className="mt-1 whitespace-pre-wrap">{n.note}</p>}
                {n.authorName && <p className="mt-1 text-[11px] text-muted-foreground">{format(t.author, { name: n.authorName })}</p>}
              </div>
            ))}
          </div>
        )}
      </Paged>
      <StoreNoteDialog
        key={editing === null ? 'closed' : editing === 'new' ? 'new' : `${editing.kind}-${editing.id}`}
        itemId={itemId}
        itemName={itemName}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </section>
  );
}

function StoreNoteDialog({
  itemId,
  itemName,
  editing,
  onClose,
  onSaved,
}: {
  itemId: string;
  itemName: string;
  editing: NoteRow | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { m } = useI18n();
  const t = m.store.notes;
  const row = editing && editing !== 'new' ? editing : null;
  const today = todayKstDateString();
  const [eventType, setEventType] = useState<EventTypeValue>(row?.eventType ?? 'OTHER');
  const [range, setRange] = useState<DateRange>({ start: row?.startDate ?? today, end: row?.endDate ?? today });
  const [title, setTitle] = useState(row?.title ?? '');
  const [note, setNote] = useState(row?.note ?? '');
  const [saving, setSaving] = useState(false);
  // 품목에만 남는 메모는 제목을 붙여 일정으로 바꿀 수 없다(새로 추가하면 된다) — 연결된 일정은 제목이 꼭 있어야 한다.
  const titleEditable = !row || row.kind === 'schedule';

  async function save() {
    if (!note.trim()) {
      toast.error(t.noteRequired);
      return;
    }
    setSaving(true);
    try {
      const body = JSON.stringify({ eventType, title: title.trim() || null, note, startDate: range.start, endDate: range.end });
      const res = row
        ? await fetch(`/api/store/items/${itemId}/notes/${row.id}${row.kind === 'schedule' ? '?kind=schedule' : ''}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body,
          })
        : await fetch(`/api/store/items/${itemId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.failed);
      toast.success(t.saved);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? t.editTitle : t.newTitle}</DialogTitle>
          <DialogDescription>{itemName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="store-note-type">{t.type}</Label>
            <Select value={eventType} onValueChange={(v) => setEventType(v as EventTypeValue)}>
              <SelectTrigger id="store-note-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {m.domain.eventTypes[o.value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t.period}</Label>
            <DateRangeCalendarInput value={range} onChange={setRange} />
          </div>
          {titleEditable && (
            <div className="space-y-1.5">
              <Label htmlFor="store-note-title">{t.scheduleTitle}</Label>
              <Input id="store-note-title" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} required={row?.kind === 'schedule'} />
              <p className="text-[11px] text-muted-foreground">{t.scheduleTitleHint}</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="store-note-body">{t.note}</Label>
            <Textarea id="store-note-body" value={note} maxLength={2000} rows={3} placeholder={t.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t.cancel}
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
