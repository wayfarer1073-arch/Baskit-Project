'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { addDays, format, parseISO } from 'date-fns';
import { LoaderCircle, MoveRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n/i18n-provider';
import { startNavigationFeedback } from '@/lib/navigation-feedback';

function shiftDay(date: string, days: number): string {
  return format(addDays(parseISO(date), days), 'yyyy-MM-dd');
}

interface DateRangeControlProps {
  asOfDate: string;
  fromDate: string | null;
  maxDate: string;
}

export function DateRangeControl({ asOfDate, fromDate, maxDate }: DateRangeControlProps) {
  const { m } = useI18n();
  const t = m.dashboard.date;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<'day' | 'range'>(fromDate ? 'range' : 'day');
  const [day, setDay] = useState(asOfDate);
  const [start, setStart] = useState(fromDate ?? asOfDate);
  const [end, setEnd] = useState(asOfDate);

  const yesterday = shiftDay(maxDate, -1);

  function apply() {
    const query = new URLSearchParams();
    if (mode === 'day') {
      query.set('date', day);
    } else {
      query.set('mode', 'range');
      query.set('from', start <= end ? start : end);
      query.set('to', start <= end ? end : start);
    }
    startNavigationFeedback();
    startTransition(() => router.push(`${pathname}?${query.toString()}`));
  }

  function goToDay(date: string) {
    setMode('day');
    setDay(date);
    const query = new URLSearchParams();
    query.set('date', date);
    startNavigationFeedback();
    startTransition(() => router.push(`${pathname}?${query.toString()}`));
  }

  const isToday = mode === 'day' && day === maxDate;
  const isYesterday = mode === 'day' && day === yesterday;

  return (
    <div className="flex shrink-0 flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:justify-end">
      <div className="inline-flex items-center gap-1 rounded-md p-0.5 text-xs" aria-label={t.quickPick}>
        <button
          type="button"
          onClick={() => goToDay(maxDate)}
          disabled={pending}
          className={cn(
            'whitespace-nowrap rounded px-2.5 py-1 font-medium transition-colors',
            isToday ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.today}
        </button>
        <button
          type="button"
          onClick={() => goToDay(yesterday)}
          disabled={pending}
          className={cn(
            'whitespace-nowrap rounded px-2.5 py-1 font-medium transition-colors',
            isYesterday ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.yesterday}
        </button>
      </div>

      <div className="inline-flex items-center gap-1 rounded-md p-0.5 text-xs" aria-label={t.mode}>
        <button
          type="button"
          onClick={() => setMode('day')}
          className={cn(
            'whitespace-nowrap rounded px-2.5 py-1 font-medium transition-colors',
            mode === 'day' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.day}
        </button>
        <button
          type="button"
          onClick={() => setMode('range')}
          className={cn(
            'whitespace-nowrap rounded px-2.5 py-1 font-medium transition-colors',
            mode === 'range' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.range}
        </button>
      </div>

      {mode === 'day' ? (
        <input
          type="date"
          value={day}
          max={maxDate}
          onChange={(event) => setDay(event.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2.5 text-sm tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={start}
            max={maxDate}
            onChange={(event) => setStart(event.target.value)}
            aria-label={t.rangeStart}
            className="h-8 rounded-md border border-border bg-background px-2.5 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <MoveRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <input
            type="date"
            value={end}
            max={maxDate}
            onChange={(event) => setEnd(event.target.value)}
            aria-label={t.rangeEnd}
            className="h-8 rounded-md border border-border bg-background px-2.5 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}

      <Button size="sm" onClick={apply} disabled={pending || (mode === 'day' ? !day : !start || !end)}>
        {pending && <LoaderCircle className="size-3.5 animate-spin" />}
        {t.apply}
      </Button>
    </div>
  );
}
