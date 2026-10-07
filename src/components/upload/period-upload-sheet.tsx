'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { WarehouseOption } from '@/components/calendar/day-panels';
import type { PeriodUploadPreview, PeriodUploadResult } from '@/domain/excel/period-plan';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';

const POLL_MS = 1500;

/** 기간 일괄 업로드 — 일자별 재고(+입고) 현황표를 고르고, 미리 본 뒤 올린다. 처리는 서버 작업으로 돌고 진행 상황을 따라간다. */
export function PeriodUploadSheet({ warehouses, isAdmin, onClose }: { warehouses: WarehouseOption[]; isAdmin: boolean; onClose: () => void }) {
  const t = useI18n().m.calendar.period;
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [stock, setStock] = useState<File | null>(null);
  const [inbound, setInbound] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<PeriodUploadPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<PeriodUploadResult | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  // 고른 내용이 바뀌면 미리 보기를 다시 해야 한다.
  function changed() {
    setPreview(null);
    setResult(null);
  }

  function body(action: 'preview' | 'run') {
    const form = new FormData();
    form.append('warehouseId', warehouseId);
    if (stock) form.append('stock', stock);
    if (inbound) form.append('inbound', inbound);
    form.append('overwrite', String(overwrite));
    form.append('action', action);
    return form;
  }

  async function runPreview() {
    setBusy(true);
    try {
      const res = await fetch('/api/upload/period', { method: 'POST', body: body('preview') });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.failed);
      setPreview(data as PeriodUploadPreview);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t.failed);
    } finally {
      setBusy(false);
    }
  }

  async function poll(id: string) {
    try {
      const res = await fetch(`/api/upload/jobs/${id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.failed);
      if (data.status === 'SUCCEEDED') {
        setResult(data.result as PeriodUploadResult);
        setProgress(null);
        setBusy(false);
        router.refresh();
        return;
      }
      if (data.status === 'FAILED') throw new Error(data.error ?? t.failed);
      if (data.result?.progress) setProgress(data.result.progress);
      timer.current = setTimeout(() => void poll(id), POLL_MS);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t.failed);
      setProgress(null);
      setBusy(false);
      router.refresh();
    }
  }

  async function start() {
    setBusy(true);
    try {
      const res = await fetch('/api/upload/period', { method: 'POST', body: body('run') });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.failed);
      setJobId(data.jobId);
      setProgress({ done: 0, total: data.preview?.uploadDays ?? 0 });
      void poll(data.jobId);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t.failed);
      setBusy(false);
    }
  }

  const running = jobId !== null && result === null && busy;
  const canRun = preview !== null && (preview.uploadDays > 0 || preview.inboundEntries - (preview.overwrite ? 0 : preview.inboundExisting) > 0);

  return (
    <Sheet open onOpenChange={(open) => !open && !running && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t.title}</SheetTitle>
          <SheetDescription>{t.description}</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          <div className="rounded-lg bg-muted/50 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">{t.howTitle}</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {t.how.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          {warehouses.length > 1 && (
            <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              {t.warehouse}
              <Select
                value={warehouseId}
                onValueChange={(v) => {
                  setWarehouseId(v);
                  changed();
                }}
                disabled={busy}
              >
                <SelectTrigger className="h-9 w-full text-sm text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.code} · {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          <FilePick
            id="period-stock"
            label={t.stock}
            file={stock}
            disabled={busy}
            onPick={(f) => {
              setStock(f);
              changed();
            }}
          />
          <FilePick
            id="period-inbound"
            label={t.inbound}
            file={inbound}
            disabled={busy}
            onPick={(f) => {
              setInbound(f);
              changed();
            }}
          />

          {isAdmin && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={overwrite}
                onCheckedChange={(v) => {
                  setOverwrite(v === true);
                  changed();
                }}
                disabled={busy}
                className="mt-0.5"
              />
              <span>
                {t.overwrite}
                <span className="block text-xs text-muted-foreground">{t.overwriteHint}</span>
              </span>
            </label>
          )}

          {!preview && !result && (
            <Button onClick={runPreview} disabled={busy || (!stock && !inbound)} className="w-full">
              {busy ? t.previewing : t.preview}
            </Button>
          )}

          {preview && !result && <PreviewSummary preview={preview} />}

          {preview && !result && (
            <div className="space-y-2">
              {progress ? (
                <div role="status" className="space-y-1.5">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-brand-accent transition-[width] duration-500"
                      style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 5}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">{progress.done > 0 ? format(t.running, progress) : t.queued}</p>
                </div>
              ) : canRun ? (
                <Button onClick={start} disabled={busy} className="w-full">
                  {t.start}
                </Button>
              ) : (
                <p className="text-sm text-status-warning">{t.nothing}</p>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <p role="status" className="rounded-lg bg-status-normal-bg px-3.5 py-3 text-sm text-status-normal">
                {format(t.done, {
                  days: result.uploadedDays,
                  created: result.inboundCreated,
                  updated: result.inboundUpdated ? format(t.doneUpdated, { count: result.inboundUpdated }) : '',
                })}
              </p>
              <Button variant="outline" onClick={onClose} className="w-full">
                {t.close}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FilePick({ id, label, file, disabled, onPick }: { id: string; label: string; file: File | null; disabled: boolean; onPick: (f: File | null) => void }) {
  const t = useI18n().m.calendar.period;
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <input ref={input} id={id} type="file" accept=".xlsx,.xls,.csv" className="sr-only" disabled={disabled} onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
        <Button asChild variant="outline" size="sm" disabled={disabled}>
          <label htmlFor={id} className={cn('cursor-pointer', disabled && 'pointer-events-none opacity-50')}>
            <FileSpreadsheet aria-hidden="true" />
            {file ? t.change : t.choose}
          </label>
        </Button>
        {file && (
          <>
            <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              disabled={disabled}
              aria-label={`${t.remove}: ${file.name}`}
              onClick={() => {
                if (input.current) input.current.value = '';
                onPick(null);
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function PreviewSummary({ preview: p }: { preview: PeriodUploadPreview }) {
  const t = useI18n().m.calendar.period;
  const notes = (items: (string | false)[]) => items.filter(Boolean).join(' · ');
  return (
    <section aria-label={t.summaryTitle} className="rounded-lg border border-border">
      <h3 className="border-b border-border px-3.5 py-2.5 text-sm font-semibold">{t.summaryTitle}</h3>
      <dl className="divide-y divide-border text-sm">
        {p.from && <Row label={t.range} value={format(t.rangeValue, { from: p.from, to: p.to ?? '', days: p.totalDays })} />}
        {p.from && (
          <Row
            label={t.days}
            value={format(t.daysValue, { upload: p.uploadDays })}
            note={notes([
              p.existingDays > 0 && format(p.overwrite ? t.existingReplace : t.existing, { count: p.existingDays }),
              p.blockedDays > 0 && format(t.blocked, { count: p.blockedDays }),
              p.futureDays > 0 && format(t.future, { count: p.futureDays }),
            ])}
          />
        )}
        {p.from && (
          <Row
            label={t.skus}
            value={format(t.skusValue, { total: p.skuCount, registered: p.registeredCount })}
            note={notes([
              p.emptyCount > 0 && format(t.empty, { count: p.emptyCount }),
              p.startedByInbound > 0 && format(t.byInbound, { count: p.startedByInbound }),
              p.inferredZeroCells > 0 && format(t.zeros, { count: p.inferredZeroCells.toLocaleString() }),
            ])}
          />
        )}
        <Row
          label={t.inboundRow}
          value={p.inboundEntries > 0 ? format(t.inboundValue, { count: p.inboundEntries, from: p.inboundFrom ?? '', to: p.inboundTo ?? '' }) : t.inboundNone}
          note={notes([p.inboundExisting > 0 && format(p.overwrite ? t.inboundExistingReplace : t.inboundExisting, { count: p.inboundExisting })])}
        />
      </dl>
      {(p.inboundUnknown.length > 0 || p.badCells > 0) && (
        <div className="space-y-1 border-t border-border px-3.5 py-2.5 text-xs text-status-warning">
          {p.inboundUnknown.length > 0 && (
            <p>
              {format(t.inboundUnknown, {
                count: p.inboundUnknown.length,
                codes: p.inboundUnknown.slice(0, 5).join(', ') + (p.inboundUnknown.length > 5 ? ' …' : ''),
              })}
            </p>
          )}
          {p.badCells > 0 && <p>{format(t.badCells, { count: p.badCells })}</p>}
        </div>
      )}
    </section>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-3 px-3.5 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        <span className="font-medium tabular-nums">{value}</span>
        {note && <span className="mt-0.5 block text-xs text-muted-foreground">{note}</span>}
      </dd>
    </div>
  );
}
