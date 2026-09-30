'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Download, Trash2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WarehouseDayPanel } from '@/components/upload/warehouse-day-panel';
import { InboundManager } from '@/components/upload/inbound-manager';
import { CountEntry } from '@/components/segment-dashboards/count-entry';
import { OrderSection, useStoreRunner } from '@/components/segment-dashboards/store-records';
import type { CalendarEntry } from '@/components/upload/upload-calendar';
import type { OrderEntryRow, StoreItemLearning } from '@/domain/segments/read-model';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { formatMoney } from '@/lib/format';
import { formatKstDate } from '@/lib/date';
import { shiftDate } from '@/domain/inventory/shipping-calendar';
import { Paged } from '@/components/ui/paged';

export interface WarehouseOption {
  id: string;
  code: string;
  name: string;
}

function toExisting(entry: CalendarEntry | undefined) {
  return entry
    ? { uploadedByName: entry.uploadedByName, uploadedAt: entry.uploadedAt, rowCount: entry.rowCount, snapshotId: entry.snapshotId, sourceFile: entry.sourceFile }
    : null;
}

/** 창고 탭 + 창고별 엑셀 업로드·입고 특이사항. 일일 재고 연동과 비정기 실사의 엑셀 탭이 함께 쓴다. */
function WarehouseUploadTabs({
  date,
  warehouses,
  entryByWarehouseId,
  blocked,
  isAdmin,
  checkMissing,
}: {
  date: string;
  warehouses: WarehouseOption[];
  entryByWarehouseId: Map<string, CalendarEntry>;
  blocked: boolean;
  isAdmin: boolean;
  /** 비정기 실사 엑셀: 이 파일로 품절 처리될 기존 SKU를 미리 보여준다. */
  checkMissing?: boolean;
}) {
  const { m } = useI18n();
  const [active, setActive] = useState(warehouses[0]?.id ?? '');
  if (warehouses.length === 0) {
    return (
      <p className="rounded-md bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
        {m.upload.noWarehouse}{' '}
        <Link href="/settings?tab=common" className="font-medium text-foreground underline underline-offset-4">
          {m.nav.items.settings}
        </Link>
      </p>
    );
  }
  return (
    <Tabs value={active} onValueChange={setActive}>
      <TabsList>
        {warehouses.map((w) => (
          <TabsTrigger key={w.id} value={w.id} className="gap-1">
            {w.name}
            {entryByWarehouseId.has(w.id) && <CheckCircle2 className="size-3.5 text-status-normal" aria-label={m.upload.uploadedMark} />}
          </TabsTrigger>
        ))}
      </TabsList>
      {warehouses.map((w) => (
        <TabsContent key={w.id} value={w.id}>
          <WarehouseDayPanel warehouseId={w.id} warehouseName={w.name} date={date} existing={toExisting(entryByWarehouseId.get(w.id))} blocked={blocked} isAdmin={isAdmin} checkMissing={checkMissing} showInbound={!checkMissing} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function DailyDayPanel(props: { date: string; warehouses: WarehouseOption[]; entryByWarehouseId: Map<string, CalendarEntry>; blocked: boolean; isAdmin: boolean }) {
  const { m } = useI18n();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{props.blocked ? m.upload.dayBlocked : m.upload.dayIntro}</p>
      <WarehouseUploadTabs {...props} />
    </div>
  );
}

/** 비정기 실사: 그날 실사 요약 + (직접 입력 | 엑셀 업로드) 탭. */
export function PeriodicDayPanel({
  date,
  today,
  warehouses,
  entryByWarehouseId,
  blocked,
  isAdmin,
  canEdit,
}: {
  date: string;
  today: string;
  warehouses: WarehouseOption[];
  entryByWarehouseId: Map<string, CalendarEntry>;
  blocked: boolean;
  isAdmin: boolean;
  canEdit: boolean;
}) {
  const { m } = useI18n();
  const t = m.calendar.periodic;
  const dayEntries = warehouses.map((w) => ({ w, entry: entryByWarehouseId.get(w.id) })).filter((x) => x.entry);
  return (
    <div className="space-y-4">
      {dayEntries.length > 0 && (
        <div className="rounded-lg border border-border px-3 py-2.5">
          <p className="text-xs font-semibold text-muted-foreground">{t.dayCounts}</p>
          <Paged items={dayEntries} pagerClassName="mt-2">
            {(pageItems) => (
              <ul className="mt-1.5 space-y-1 text-sm">
                {pageItems.map(({ w, entry }) => (
                  <li key={w.id} className="flex items-center justify-between gap-2">
                    <span>{w.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(t.skus, { count: entry!.rowCount })} · {entry!.isManual ? t.manual : t.file}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Paged>
        </div>
      )}
      <Tabs defaultValue="direct">
        <TabsList>
          <TabsTrigger value="direct">{t.direct}</TabsTrigger>
          <TabsTrigger value="excel">{t.excel}</TabsTrigger>
          <TabsTrigger value="inbound">{t.inbound}</TabsTrigger>
        </TabsList>
        <TabsContent value="direct" className="pt-2">
          {blocked ? (
            <p className="rounded-md bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">{t.blocked}</p>
          ) : !canEdit ? (
            <p className="rounded-md bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">{m.calendar.panel.viewer}</p>
          ) : (
            <CountEntry today={today} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} fixedDate={date} />
          )}
        </TabsContent>
        <TabsContent value="excel" className="pt-2">
          <WarehouseUploadTabs date={date} warehouses={warehouses} entryByWarehouseId={entryByWarehouseId} blocked={blocked} isAdmin={isAdmin} checkMissing />
        </TabsContent>
        <TabsContent value="inbound" className="space-y-3 pt-2">
          <p className="text-xs text-muted-foreground">{t.inboundHint}</p>
          {!canEdit ? (
            <p className="rounded-md bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">{m.calendar.panel.viewer}</p>
          ) : warehouses.length === 1 ? (
            <InboundManager warehouseId={warehouses[0].id} date={date} />
          ) : (
            <Tabs defaultValue={warehouses[0]?.id}>
              <TabsList>
                {warehouses.map((w) => (
                  <TabsTrigger key={w.id} value={w.id}>
                    {w.name}
                  </TabsTrigger>
                ))}
              </TabsList>
              {warehouses.map((w) => (
                <TabsContent key={w.id} value={w.id}>
                  <InboundManager warehouseId={w.id} date={date} />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** 매출 한 칸 — Enter로 저장하면 다음 날로 넘어가 밀린 매출을 이어서 입력할 수 있다. */
export function SalesQuickEntry({
  date,
  today,
  current,
  canEdit,
  onNext,
}: {
  date: string;
  today: string;
  current: number | null;
  canEdit: boolean;
  onNext: (nextDate: string) => void;
}) {
  const { m, locale } = useI18n();
  const t = m.calendar.sales;
  const router = useRouter();
  const [amount, setAmount] = useState(current === null ? '' : current.toLocaleString());
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [date]);

  const next = shiftDate(date, 1);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount.replace(/[,\s]/g, ''));
    if (!amount.trim() || !Number.isInteger(value) || value < 0) {
      toast.error(t.invalid);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/store/sales', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, amount: value }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error);
      const moveOn = next <= today;
      toast.success(format(moveOn ? t.savedNext : t.saved, { date: formatKstDate(date) }));
      router.refresh();
      if (moveOn) onNext(next);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t.failed);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(format(t.deleteConfirm, { date: formatKstDate(date) }))) return;
    const res = await fetch(`/api/store/sales?date=${date}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error(t.failed);
      return;
    }
    setAmount('');
    toast.success(format(t.deleted, { date: formatKstDate(date) }));
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t.title}</h3>
        <span className="text-xs text-muted-foreground">{current === null ? t.none : format(t.current, { amount: formatMoney(current, locale) })}</span>
      </div>
      {canEdit ? (
        <form onSubmit={save} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-44 flex-1 space-y-1.5">
            <Label htmlFor="calendar-sales-amount">{t.amount}</Label>
            <Input
              ref={inputRef}
              id="calendar-sales-amount"
              inputMode="numeric"
              pattern="[0-9,]*"
              placeholder={t.placeholder}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={saving}>
            {t.save}
          </Button>
          {current !== null && (
            <Button type="button" variant="ghost" size="icon" onClick={remove} aria-label={t.delete}>
              <Trash2 className="size-4" />
            </Button>
          )}
          <p className="basis-full text-[11px] text-muted-foreground">{t.quickHint}</p>
        </form>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{m.calendar.panel.viewer}</p>
      )}
    </section>
  );
}

/** 여러 날 매출을 양식(날짜·매출)으로 한 번에 올린다. */
function SalesBulkUpload() {
  const { m } = useI18n();
  const t = m.calendar.sales;
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload() {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/store/sales/import', { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error);
      toast.success(format(t.bulkDone, { count: body.saved }) + (body.skipped ? format(t.bulkSkipped, { count: body.skipped }) : ''));
      setFile(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t.failed);
    } finally {
      setUploading(false);
    }
  }

  return (
    <details className="group rounded-lg border border-border px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold marker:text-muted-foreground">{t.bulkTitle}</summary>
      <p className="mt-2 text-xs text-muted-foreground">{t.bulkHint}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href="/api/templates/sales">
            <Download className="size-3.5" />
            {t.bulkTemplate}
          </a>
        </Button>
        <Input type="file" accept=".xls,.xlsx,.csv,.tsv,.txt" aria-label={t.bulkUpload} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-9 max-w-64" />
        <Button size="sm" onClick={upload} disabled={!file || uploading}>
          <UploadCloud className="size-4" />
          {uploading ? t.bulkUploading : t.bulkUpload}
        </Button>
      </div>
    </details>
  );
}

/** 매장 발주 예측: 매출 빠른 입력 + 여러 날 매출 올리기 + 그날 발주 기록. */
export function StoreDayPanel({
  date,
  today,
  salesAmount,
  items,
  orders,
  canEdit,
  onNext,
}: {
  date: string;
  today: string;
  salesAmount: number | null;
  items: StoreItemLearning[];
  orders: OrderEntryRow[];
  canEdit: boolean;
  onNext: (nextDate: string) => void;
}) {
  const { busy, run } = useStoreRunner();
  return (
    <div className="space-y-4">
      <SalesQuickEntry key={date} date={date} today={today} current={salesAmount} canEdit={canEdit} onNext={onNext} />
      {canEdit && <SalesBulkUpload />}
      {canEdit && (
        <div className="overflow-hidden rounded-lg border border-border [&>section]:rounded-none [&>section]:border-0">
          <OrderSection key={date} today={today} items={items} orders={orders} busy={busy} run={run} fixedDate={date} />
        </div>
      )}
    </div>
  );
}
