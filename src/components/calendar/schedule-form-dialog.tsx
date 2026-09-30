'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DateRangeCalendarInput, type DateRange } from '@/components/events/date-range-calendar-input';
import { EVENT_TYPE_OPTIONS, type EventTypeValue } from '@/lib/event-types';
import { SCHEDULE_COLORS, SCHEDULE_COLOR_CLASSNAMES, isScheduleColor, type ScheduleColor } from '@/lib/schedule-colors';
import type { ScheduleRow } from '@/domain/events/schedule-types';
import type { Segment } from '@/lib/segments';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';

/** 일정에 연결한 항목 — 재고 SKU(창고 소속) 또는 매장 품목. */
interface Member {
  kind: 'sku' | 'store';
  id: string;
  name: string;
  code: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
}

function membersOf(schedule: ScheduleRow): Member[] {
  const skus: Member[] = schedule.events
    .filter((e) => e.skuId)
    .map((e) => ({ kind: 'sku', id: e.skuId!, name: e.productName ?? '', code: e.productCode, warehouseCode: e.warehouseCode, warehouseName: e.warehouseName }));
  const items: Member[] = schedule.storeItems.map((i) => ({ kind: 'store', id: i.storeItemId, name: i.name, code: null, warehouseCode: null, warehouseName: null }));
  return [...skus, ...items];
}

/** 이 항목이 어느 방식의 것인지 — 매장 품목은 매장 발주 예측, 재고 SKU는 켜 둔 재고 방식(들)과 창고. */
function useMemberSource(enabledSegments: Segment[]) {
  const { m } = useI18n();
  const stockModes = enabledSegments.filter((s) => s !== 'ORDER_CYCLE').map((s) => m.segments[s].label);
  return (member: Member) =>
    member.kind === 'store' ? m.segments.ORDER_CYCLE.label : [stockModes.join('·') || m.calendar.schedule.stockSku, member.warehouseName].filter(Boolean).join(' · ');
}

export interface ScheduleFormDialogProps {
  /** 수정할 일정. 없으면 새 일정(defaultDate부터 하루짜리). */
  schedule: ScheduleRow | null;
  defaultDate: string;
  enabledSegments: Segment[];
  canEdit: boolean;
  onClose: () => void;
}

export function ScheduleFormDialog({ schedule, defaultDate, enabledSegments, canEdit, onClose }: ScheduleFormDialogProps) {
  const { m } = useI18n();
  const t = m.calendar.schedule;
  const router = useRouter();
  const sourceOf = useMemberSource(enabledSegments);
  const [eventType, setEventType] = useState<EventTypeValue>(schedule?.eventType ?? 'OTHER');
  const [range, setRange] = useState<DateRange>({ start: schedule?.startDate ?? defaultDate, end: schedule?.endDate ?? defaultDate });
  const [title, setTitle] = useState(schedule?.title ?? '');
  const [note, setNote] = useState(schedule?.note ?? '');
  const [color, setColor] = useState<ScheduleColor>(schedule && isScheduleColor(schedule.color) ? schedule.color : 'lime');
  const [members, setMembers] = useState<Member[]>(() => (schedule ? membersOf(schedule) : []));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Member[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/schedules/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { results: [] }))
        .then((body) => setResults(body.results ?? []))
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const picked = new Set(members.map((mb) => `${mb.kind}:${mb.id}`));

  function add(member: Member) {
    if (!picked.has(`${member.kind}:${member.id}`)) setMembers((prev) => [...prev, member]);
    setQuery('');
    setResults(null);
  }

  function autoTitle() {
    const category = m.domain.eventTypes[eventType];
    if (members.length === 0) return category;
    const first = members[0].name;
    return `${category} · ${members.length > 1 ? format(t.autoTitleMore, { name: first, count: members.length - 1 }) : first}`;
  }

  async function save() {
    setSaving(true);
    try {
      const body = {
        eventType,
        title: title.trim() || autoTitle(),
        startDate: range.start,
        endDate: range.end,
        color,
        note: note.trim(),
        skuIds: members.filter((mb) => mb.kind === 'sku').map((mb) => mb.id),
        storeItemIds: members.filter((mb) => mb.kind === 'store').map((mb) => mb.id),
      };
      const res = await fetch(schedule ? `/api/schedules/${schedule.id}` : '/api/schedules', {
        method: schedule ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success(schedule ? t.updated : t.created);
      router.refresh();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t.failed);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!schedule || !confirm(format(t.deleteConfirm, { title: schedule.title }))) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/schedules/${schedule.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success(t.deleted);
      router.refresh();
      onClose();
    } catch {
      toast.error(t.failed);
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{schedule ? t.editTitle : t.newTitle}</DialogTitle>
          <DialogDescription>{t.itemsHint}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="schedule-category">{t.category}</Label>
              <Select value={eventType} onValueChange={(v) => setEventType(v as EventTypeValue)} disabled={!canEdit}>
                <SelectTrigger id="schedule-category" className="w-full">
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="schedule-title">{t.titleLabel}</Label>
            <Input id="schedule-title" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle()} disabled={!canEdit} />
            <p className="text-[11px] text-muted-foreground">{t.titlePlaceholder}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="schedule-search">{t.items}</Label>
            {members.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {members.map((mb) => (
                  <li key={`${mb.kind}:${mb.id}`} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/50 py-1 pr-1 pl-2.5 text-xs">
                    <span className="truncate font-medium">{mb.name}</span>
                    <span className="shrink-0 text-muted-foreground">{sourceOf(mb)}</span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setMembers((prev) => prev.filter((x) => !(x.kind === mb.kind && x.id === mb.id)))}
                        className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={format(t.remove, { name: mb.name })}
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="schedule-search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    if (!e.target.value.trim()) setResults(null);
                  }}
                  placeholder={t.searchPlaceholder}
                  className="pl-8"
                  autoComplete="off"
                />
                {query.trim() !== '' && (
                  <ul className="absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-md" role="listbox">
                    {results === null && <li className="px-3 py-2 text-xs text-muted-foreground">{t.searching}</li>}
                    {results?.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">{t.noMatch}</li>}
                    {results?.map((r) => {
                      const already = picked.has(`${r.kind}:${r.id}`);
                      return (
                        <li key={`${r.kind}:${r.id}`}>
                          <button
                            type="button"
                            onClick={() => add(r)}
                            disabled={already}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{r.name}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">{[r.code, sourceOf(r)].filter(Boolean).join(' · ')}</span>
                            </span>
                            <span
                              className={cn(
                                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                r.kind === 'store' ? 'bg-status-increase-bg text-status-increase' : 'bg-muted text-muted-foreground',
                              )}
                            >
                              {r.kind === 'store' ? t.storeItem : (r.warehouseCode ?? t.stockSku)}
                            </span>
                            {already && <Check className="size-4 text-status-normal" aria-hidden="true" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="schedule-note">{t.note}</Label>
            <Textarea id="schedule-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.notePlaceholder} disabled={!canEdit} />
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t.color}</p>
            <div className="flex flex-wrap gap-2">
              {SCHEDULE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  disabled={!canEdit}
                  aria-label={format(m.work.schedule.colorAria, { color: m.work.schedule.colors[c] })}
                  aria-pressed={color === c}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full ring-1 ring-border transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    SCHEDULE_COLOR_CLASSNAMES[c].swatch,
                    color === c && 'ring-2 ring-foreground',
                  )}
                >
                  {color === c && <Check className="size-4 text-foreground/70" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center justify-between gap-2 pt-2">
            {schedule ? (
              <Button type="button" variant="ghost" className="text-status-danger hover:text-status-danger" onClick={remove} disabled={saving}>
                <Trash2 className="size-4" />
                {t.delete}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                {t.cancel}
              </Button>
              <Button type="button" onClick={save} disabled={saving}>
                {saving ? t.saving : t.save}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
