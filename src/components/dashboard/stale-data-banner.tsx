'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { CircleAlert, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/components/i18n/i18n-provider';
import type { InventoryRow } from '@/domain/inventory/read-model';
import { format } from '@/lib/i18n/locales';
import { todayKstDateString } from '@/lib/date';

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

interface StaleWarehouse {
  code: string;
  date: string;
  days: number;
}

/** 창고별 마지막 재고 자료일 — 그 자료가 기준일보다 출고일 하루 이상 밀렸으면 갱신이 필요한 창고. */
export function staleWarehouses(rows: InventoryRow[], asOfDate: string): StaleWarehouse[] {
  const latest = new Map<string, { code: string; date: string; stale: boolean }>();
  for (const r of rows) {
    const date = r.analysis.latest.date;
    const stale = (r.analysis.operating?.staleShippingDays ?? 0) > 0;
    const current = latest.get(r.descriptor.warehouseId);
    if (!current || date > current.date) latest.set(r.descriptor.warehouseId, { code: r.descriptor.warehouseCode, date, stale });
    else if (date === current.date && stale) current.stale = true;
  }
  return [...latest.values()]
    .filter((w) => w.stale)
    .map((w) => ({ code: w.code, date: w.date, days: daysBetween(w.date, asOfDate) }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** 대시보드 맨 위 — 기준일 재고 자료가 없을 때 마지막 업데이트일과 추정 현황을 알린다. */
export function StaleDataBanner({ rows, asOfDate }: { rows: InventoryRow[]; asOfDate: string }) {
  const { m } = useI18n();
  const t = m.dashboard.nowcast;
  const stale = useMemo(() => staleWarehouses(rows, asOfDate), [rows, asOfDate]);
  const counts = useMemo(() => {
    let estimated = 0;
    let unavailable = 0;
    for (const r of rows) {
      if (!r.nowcast || r.descriptor.isSoldOut) continue;
      if (r.nowcast.status === 'estimated') estimated++;
      else unavailable++;
    }
    return { estimated, unavailable };
  }, [rows]);
  if (stale.length === 0) return null;

  const isToday = asOfDate === todayKstDateString();
  const single = stale.length === 1;
  return (
    <section
      role="status"
      className="flex flex-col gap-3 rounded-xl border border-status-danger/25 bg-status-danger-bg/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 gap-2.5">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-status-danger" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <h2 className="text-sm font-semibold text-status-danger">{isToday ? t.bannerTitle : t.pastTitle}</h2>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
            <span className="text-muted-foreground">{t.lastUpdate}:</span>
            {stale.map((w) => (
              <span key={w.code} className="font-medium whitespace-nowrap tabular-nums">
                {single ? format(t.lastUpdateValue, { date: w.date, days: w.days }) : format(t.warehouseValue, { code: w.code, date: w.date, days: w.days })}
              </span>
            ))}
          </div>
          {counts.estimated + counts.unavailable > 0 && (
            <div className="space-y-0.5 text-xs leading-relaxed text-muted-foreground">
              <p>{format(t.summary, { estimated: counts.estimated, unavailable: counts.unavailable })}</p>
              <p>{t.hint}</p>
            </div>
          )}
        </div>
      </div>
      <Button asChild size="sm" className="shrink-0 self-start sm:self-center">
        <Link href={`/upload?date=${asOfDate}&mode=DAILY_SYNC`}>
          <UploadCloud aria-hidden="true" />
          {t.upload}
        </Link>
      </Button>
    </section>
  );
}
