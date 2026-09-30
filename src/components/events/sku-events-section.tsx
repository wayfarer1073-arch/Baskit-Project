'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { Paged } from '@/components/ui/paged';
import { EventFormDialog, type EditingEvent } from '@/components/events/event-form-dialog';
import { formatKstDate } from '@/lib/date';
import { formatSigned } from '@/lib/format';
import { eventTypeText } from '@/lib/event-types';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

interface EventItem {
  id: string;
  eventType: string;
  quantity: number | null;
  note: string;
  eventDate: string;
  endDate: string | null;
  title: string | null;
  scheduleId: string | null;
  createdBy: { name: string };
}

/**
 * 재고 SKU의 메모/이벤트 — 일일 재고 연동 상세와 같은 기록(InventoryEvent)을 비정기 실사 상세에서도 보고 고친다.
 * 캘린더에서 등록한 일정도 SKU마다 여기 나오고, 여기서 제목·기간을 고치면 캘린더 일정도 바뀐다.
 */
export function SkuEventsSection({ warehouseId, skuId, skuLabel }: { warehouseId: string; skuId: string; skuLabel: string }) {
  const { m } = useI18n();
  const t = m.inventory.detail;
  const [events, setEvents] = useState<EventItem[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EditingEvent | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/events?skuId=${skuId}`);
    if (res.ok) setEvents((await res.json()).events);
  }, [skuId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function remove(id: string) {
    if (!confirm(t.deleteEventConfirm)) return;
    const res = await fetch(`/api/events/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success(t.deleted);
      load();
    } else toast.error(t.deleteFailed);
  }

  return (
    <section aria-label={t.events}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t.events}</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="size-3.5" /> {t.add}
        </Button>
      </div>
      {events.length === 0 && <p className="text-sm text-muted-foreground">{t.noEvents}</p>}
      <Paged items={events} pagerClassName="mt-2">
        {(pageItems) => (
          <div className="space-y-2">
            {pageItems.map((e) => {
              const start = formatKstDate(e.eventDate);
              const end = e.endDate ? formatKstDate(e.endDate) : null;
              return (
                <div key={e.id} className="rounded-md border p-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" className="shrink-0">
                        {eventTypeText(e.eventType, m.domain.eventTypes)}
                      </Badge>
                      {e.scheduleId && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                          <CalendarDays className="size-3" aria-hidden="true" />
                          {t.calendarLinked}
                          <InfoTooltip>{t.calendarLinkedTip}</InfoTooltip>
                        </span>
                      )}
                      {e.title && <span className="truncate font-semibold">{e.title}</span>}
                      {e.quantity !== null && <span className="shrink-0 text-xs text-muted-foreground">{format(t.qty, { count: formatSigned(e.quantity) })}</span>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      {end && end !== start ? `${start} ~ ${end}` : start}
                      <button
                        type="button"
                        onClick={() => {
                          setEditing({
                            id: e.id,
                            eventType: e.eventType as EditingEvent['eventType'],
                            quantity: e.quantity,
                            title: e.title,
                            note: e.note,
                            eventDate: e.eventDate,
                            endDate: e.endDate,
                          });
                          setFormOpen(true);
                        }}
                        className="rounded-md p-1.5 transition-colors hover:bg-muted"
                        aria-label={t.edit}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(e.id)}
                        className="rounded-md p-1.5 transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={t.delete}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-1">{e.note}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{format(t.author, { name: e.createdBy.name })}</p>
                </div>
              );
            })}
          </div>
        )}
      </Paged>
      <EventFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        warehouseId={warehouseId}
        skuId={skuId}
        skuLabel={skuLabel}
        editingEvent={editing}
        onCreated={load}
      />
    </section>
  );
}
