'use client';

import { useMemo, useState } from 'react';
import { format as formatDate, parseISO, subMonths } from 'date-fns';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { formatKstDate, todayKstDateString } from '@/lib/date';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { Paged } from '@/components/ui/paged';

/** 목록에 보여 줄 지난 휴무일의 범위(개월) — 그보다 오래된 휴무일은 목록에서만 숨기고 기록·계산에는 그대로 남는다. */
const VISIBLE_PAST_MONTHS = 6;

interface HolidayRow {
  id: string;
  date: string;
  name: string;
}

interface HolidayManagementProps {
  isAdmin: boolean;
  initialHolidays: HolidayRow[];
}

export function HolidayManagement({ isAdmin, initialHolidays }: HolidayManagementProps) {
  const t = useI18n().m.settingsScreens;
  const [holidays, setHolidays] = useState(initialHolidays);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 최근 6개월 이후(앞으로 올 휴무일 포함)만 보여 준다.
  const { visible, olderCount } = useMemo(() => {
    const cutoff = formatDate(subMonths(parseISO(todayKstDateString()), VISIBLE_PAST_MONTHS), 'yyyy-MM-dd');
    const visible = holidays.filter((h) => formatKstDate(h.date) >= cutoff);
    return { visible, olderCount: holidays.length - visible.length };
  }, [holidays]);

  async function addHoliday() {
    if (!date || !name.trim()) {
      toast.error(t.holidays.required);
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, name: name.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? t.common.addFailed);
        return;
      }
      setHolidays((prev) => [...prev, body.holiday].sort((a, b) => a.date.localeCompare(b.date)));
      toast.success(t.holidays.added);
      setDate('');
      setName('');
    } catch {
      toast.error(t.common.addNetworkFailed);
    } finally {
      setAdding(false);
    }
  }

  async function removeHoliday(holiday: HolidayRow) {
    if (!confirm(format(t.holidays.deleteConfirm, { date: formatKstDate(holiday.date), name: holiday.name }))) return;
    setDeletingId(holiday.id);
    try {
      const res = await fetch(`/api/holidays/${holiday.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? t.common.deleteFailed);
        return;
      }
      setHolidays((prev) => prev.filter((h) => h.id !== holiday.id));
      toast.success(t.holidays.deleted);
    } catch {
      toast.error(t.common.deleteNetworkFailed);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>{t.holidays.title}</CardTitle>
          <InfoTooltip tone="header">
            {t.holidays.description}
          </InfoTooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {visible.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.holidays.empty}</p>
        ) : (
          <Paged items={visible} pagerClassName="mt-2">
            {(pageItems) => (
              <div className="space-y-1.5">
                {pageItems.map((h) => (
                  <div key={h.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums text-muted-foreground">{formatKstDate(h.date)}</span>
                      <span className="font-medium">{h.name}</span>
                    </div>
                    {isAdmin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={deletingId === h.id}
                        onClick={() => removeHoliday(h)}
                        aria-label={format(t.holidays.deleteAria, { name: h.name })}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Paged>
        )}
        {olderCount > 0 && <p className="text-xs text-muted-foreground">{format(t.holidays.olderHidden, { count: olderCount, months: VISIBLE_PAST_MONTHS })}</p>}

        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
            <div className="space-y-1.5">
              <Label htmlFor="holiday-date">{t.holidays.date}</Label>
              <Input id="holiday-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="holiday-name">{t.holidays.name}</Label>
              <Input id="holiday-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.holidays.namePlaceholder} className="h-9 w-40" />
            </div>
            <Button size="sm" onClick={addHoliday} disabled={adding || !date || !name.trim()}>
              <Plus className="size-3.5" />
              {t.common.add}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
