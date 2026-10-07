'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarOff, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { formatKstDate } from '@/lib/date';
import { cn } from '@/lib/utils';

export interface HolidayInfo {
  id: string;
  name: string;
}

/**
 * 캘린더 날짜 패널의 "휴무일로 지정" — 켜면 사유(자주 쓰는 사유 또는 직접 입력)를 받아 저장하고, 끄면 지정을 푼다.
 * 휴무일은 주말처럼 출고가 없는 날로 계산되므로, 업로드하면서 바로 표시할 수 있게 날짜마다 둔다.
 * 관리자만 바꿀 수 있고, 다른 사람에게는 지정된 사유만 보인다.
 */
export function HolidayToggle({ date, holiday: initial, isAdmin, className }: { date: string; holiday: HolidayInfo | null; isAdmin: boolean; className?: string }) {
  const { m } = useI18n();
  const t = m.calendar.holiday;
  const router = useRouter();
  const [holiday, setHoliday] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const dateLabel = formatKstDate(date);

  if (!isAdmin) {
    return holiday ? <p className={cn('flex items-center gap-1.5 text-xs font-medium text-destructive', className)}>{format(t.readonly, { name: holiday.name })}</p> : null;
  }

  async function request(url: string, init: RequestInit) {
    setBusy(true);
    try {
      const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? t.failed);
        return null;
      }
      // 캘린더 칸의 휴무 표시·업로드 차단과 대시보드 계산이 바로 따라오도록 서버 데이터를 다시 읽는다.
      router.refresh();
      return body as { holiday?: { id: string; name: string } };
    } catch {
      toast.error(t.failed);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const name = reason.trim();
    if (!name) {
      toast.error(t.required);
      return;
    }
    const body = holiday
      ? await request(`/api/holidays/${holiday.id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
      : await request('/api/holidays', { method: 'POST', body: JSON.stringify({ date, name }) });
    if (!body?.holiday) return;
    setHoliday({ id: body.holiday.id, name: body.holiday.name });
    setEditing(false);
    toast.success(holiday ? t.renamed : format(t.added, { date: dateLabel }));
  }

  async function remove() {
    if (!holiday) return;
    const body = await request(`/api/holidays/${holiday.id}`, { method: 'DELETE' });
    if (!body) return;
    setHoliday(null);
    setEditing(false);
    toast.success(format(t.removed, { date: dateLabel }));
  }

  return (
    <div className={cn('rounded-lg border border-border bg-muted/30 px-3 py-2.5', holiday && 'border-destructive/30 bg-destructive/5', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <CalendarOff className={cn('size-4 shrink-0', holiday ? 'text-destructive' : 'text-muted-foreground')} aria-hidden="true" />
          <span className="text-sm font-medium">{t.label}</span>
          <InfoTooltip>{t.tip}</InfoTooltip>
        </div>
        <Switch
          checked={!!holiday || editing}
          disabled={busy}
          aria-label={t.label}
          onCheckedChange={(checked) => {
            if (checked) {
              setReason('');
              setEditing(true);
            } else if (holiday) remove();
            else setEditing(false);
          }}
        />
      </div>

      {holiday && !editing && (
        <div className="mt-1.5 flex items-center gap-2 pl-5.5 text-xs">
          <span className="min-w-0 truncate text-destructive">{format(t.reason, { name: holiday.name })}</span>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => {
              setReason(holiday.name);
              setEditing(true);
            }}
          >
            <Pencil className="size-3" aria-hidden="true" />
            {t.edit}
          </button>
        </div>
      )}

      {editing && (
        <form
          className="mt-2.5 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <p className="text-xs text-muted-foreground">{t.reasonLabel}</p>
          <div className="flex flex-wrap gap-1.5">
            {t.presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setReason(p)}
                aria-pressed={reason === p}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors',
                  reason === p ? 'border-foreground bg-foreground text-background' : 'border-border bg-background hover:bg-muted',
                )}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={30} placeholder={t.reasonPlaceholder} aria-label={t.reasonLabel} className="h-8 text-sm" />
            <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0" disabled={busy} onClick={() => setEditing(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" size="sm" className="h-8 shrink-0" disabled={busy || !reason.trim()}>
              {t.save}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
