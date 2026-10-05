'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SectionPanel } from '@/components/segment-dashboards/dashboard-parts';
import { MENU_SALES_FIELDS, REQUIRED_MENU_SALES_FIELDS, type MenuSalesField, type MenuSalesLayout } from '@/domain/excel/menu-sales-fields';
import type { MenuSalesPreview, StoreMenuRow } from '@/domain/segments/read-model';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

const NONE = '__none__';
const NEW = '__new__';
const IGNORE = '__ignore__';

/** 파일 한 개의 미리보기 → (열 지정) → 메뉴 연결 → 저장. 저장 전에는 아무것도 바뀌지 않는다. */
export function MenuSalesUpload({ menus, today, readOnly }: { menus: StoreMenuRow[]; today: string; readOnly: boolean }) {
  const { m, locale } = useI18n();
  const t = m.store.menus.upload;
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MenuSalesPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [layout, setLayout] = useState<MenuSalesLayout | null>(null);
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState(t.defaultTemplateName);
  const [date, setDate] = useState('');
  const [links, setLinks] = useState<Record<string, string>>({});

  async function load(next: File, chosen: MenuSalesLayout | null, chosenDate: string) {
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', next);
      if (chosen) body.append('layout', JSON.stringify(chosen));
      if (chosenDate) body.append('date', chosenDate);
      const res = await fetch('/api/store/menu-sales/preview', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.failed);
      const p = data as MenuSalesPreview;
      setPreview(p);
      setLayout({ headerRowIndex: p.headerRowIndex, columns: p.columns });
      if (p.source === 'none') setCustomizing(true);
      if (!chosenDate && p.periodDate) setDate(p.periodDate);
      setLinks(Object.fromEntries(p.names.map((n) => [n.name, n.match.kind === 'menu' ? n.match.menuId : n.match.kind === 'ignore' ? IGNORE : NEW])));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.failed);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setLayout(null);
    setCustomizing(false);
    setSaveTemplate(false);
    setDate('');
    if (fileInput.current) fileInput.current.value = '';
  }

  const rows = useMemo(() => (preview ? preview.rows.map((r) => ({ ...r, date: r.date ?? (date || null) })) : []), [preview, date]);
  const dates = useMemo(() => [...new Set(rows.map((r) => r.date).filter(Boolean))].sort() as string[], [rows]);
  const missingDate = rows.some((r) => !r.date);

  async function save() {
    if (!preview || rows.length === 0) return;
    if (missingDate) {
      toast.error(t.pickDate);
      return;
    }
    const decisions = preview.names.map((n) => {
      const link = links[n.name] ?? NEW;
      return link === NEW
        ? { action: 'new' as const, name: n.name, code: n.code }
        : link === IGNORE
          ? { action: 'ignore' as const, name: n.name, code: n.code }
          : { action: 'menu' as const, name: n.name, code: n.code, menuId: link };
    });
    setBusy(true);
    try {
      const res = await fetch('/api/store/menu-sales/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: rows.map((r) => ({ date: r.date, name: r.name, quantity: r.quantity, amount: r.amount })),
          decisions,
          template: layout ? { save: saveTemplate, name: templateName.trim() || t.defaultTemplateName, headers: preview.headers, layout } : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.failed);
      toast.success(format(t.saved, { saved: data.saved, from: data.from ?? '', to: data.to ?? '', created: data.menusCreated }));
      reset();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.failed);
    } finally {
      setBusy(false);
    }
  }

  const sourceText = preview ? (preview.source === 'template' ? format(t.source.template, { name: preview.templateName ?? '' }) : t.source[preview.source]) : '';

  return (
    <SectionPanel title={t.title} description={t.help}>
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            id="menu-sales-file"
            disabled={readOnly || busy}
            onChange={(e) => {
              const next = e.target.files?.[0];
              if (!next) return;
              setFile(next);
              setLayout(null);
              setDate('');
              void load(next, null, '');
            }}
          />
          <Button asChild variant={preview ? 'outline' : 'default'} disabled={readOnly || busy}>
            <label htmlFor="menu-sales-file" className={cn('cursor-pointer', (readOnly || busy) && 'pointer-events-none opacity-50')}>
              <FileSpreadsheet aria-hidden="true" />
              {busy && !preview ? t.reading : t.choose}
            </label>
          </Button>
          {file ? <span className="truncate text-sm text-foreground">{file.name}</span> : <span className="text-xs text-muted-foreground">{t.fileHint}</span>}
          {preview && (
            <Button variant="ghost" size="sm" onClick={reset} disabled={busy} className="ml-auto">
              {t.cancel}
            </Button>
          )}
        </div>

        {preview && file && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3.5 py-2.5 text-sm">
              <span className={cn(preview.source === 'none' ? 'text-status-warning' : 'text-foreground')}>{sourceText}</span>
              <Button variant="outline" size="sm" onClick={() => setCustomizing((v) => !v)}>
                <SlidersHorizontal aria-hidden="true" />
                {customizing ? t.hideCustomize : t.customize}
              </Button>
            </div>

            {customizing && layout && (
              <ColumnPicker
                preview={preview}
                layout={layout}
                onChange={setLayout}
                onApply={() => {
                  setSaveTemplate(true);
                  void load(file, layout, date);
                }}
                busy={busy}
              />
            )}

            {preview.missing.length === 0 && (
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  {(preview.needsDate || date) && (
                    <label className="flex items-center gap-2">
                      <span className="text-muted-foreground">{t.date}</span>
                      <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" />
                    </label>
                  )}
                  {preview.periodDate && date === preview.periodDate && <span className="text-xs text-muted-foreground">{format(t.periodDate, { date: preview.periodDate })}</span>}
                  {preview.needsDate && !date && <span className="text-xs text-status-warning">{t.needsDate}</span>}
                  {preview.periodRange && preview.needsDate && (
                    <span className="text-xs text-status-warning">{format(t.periodRange, { from: preview.periodRange[0], to: preview.periodRange[1] })}</span>
                  )}
                  {preview.skipped > 0 && <span className="text-xs text-muted-foreground">{format(t.skipped, { count: preview.skipped })}</span>}
                </div>

                {preview.names.length === 0 ? (
                  <p className="text-sm text-status-warning">{t.noRows}</p>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <h3 className="text-sm font-semibold">{t.names}</h3>
                      <p className="text-xs text-muted-foreground">{t.namesHelp}</p>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t.col.name}</TableHead>
                            <TableHead className="text-right">{t.col.qty}</TableHead>
                            <TableHead className="text-right">{t.col.amount}</TableHead>
                            <TableHead className="min-w-56">{t.col.link}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.names.map((n) => (
                            <TableRow key={n.name}>
                              <TableCell>
                                <span className="font-medium">{n.name}</span>
                                {n.code && <span className="ml-1.5 text-xs text-muted-foreground">{n.code}</span>}
                                {n.match.kind === 'menu' && <span className="block text-[11px] text-muted-foreground">{t.via[n.match.via]}</span>}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{n.quantity.toLocaleString()}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{n.amount === null ? '—' : formatMoney(n.amount, locale)}</TableCell>
                              <TableCell>
                                <Select value={links[n.name] ?? NEW} onValueChange={(v) => setLinks((prev) => ({ ...prev, [n.name]: v }))}>
                                  <SelectTrigger className="h-8 w-full text-xs" aria-label={format(t.linkAria, { name: n.name })}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={NEW}>{t.newMenu}</SelectItem>
                                    <SelectItem value={IGNORE}>{t.ignore}</SelectItem>
                                    {menus.map((menu) => (
                                      <SelectItem key={menu.id} value={menu.id}>
                                        {menu.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <div className="space-y-2">
                    <p className="text-sm tabular-nums">
                      {format(t.summary, {
                        rows: rows.length,
                        names: preview.names.length,
                        dates: dates.length === 0 ? '—' : dates.length === 1 ? dates[0] : `${dates[0]} ~ ${dates[dates.length - 1]}`,
                      })}
                    </p>
                    {preview.source !== 'template' && (
                      <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox checked={saveTemplate} onCheckedChange={(v) => setSaveTemplate(v === true)} />
                        {t.saveTemplate}
                        {saveTemplate && (
                          <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} aria-label={t.templateName} className="h-7 w-40 text-xs" maxLength={60} />
                        )}
                      </label>
                    )}
                  </div>
                  <Button onClick={save} disabled={readOnly || busy || rows.length === 0 || missingDate}>
                    {busy ? t.saving : t.save}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </SectionPanel>
  );
}

/** 머리글 행과 필드별 열을 직접 고른다. 고른 열로 다시 읽으면 그 양식을 저장할 수 있다. */
function ColumnPicker({
  preview,
  layout,
  onChange,
  onApply,
  busy,
}: {
  preview: MenuSalesPreview;
  layout: MenuSalesLayout;
  onChange: (l: MenuSalesLayout) => void;
  onApply: () => void;
  busy: boolean;
}) {
  const t = useI18n().m.store.menus.upload;
  const headerCells = (preview.topRows[layout.headerRowIndex] ?? []).map((h) => h.trim()).filter(Boolean);
  const canApply = REQUIRED_MENU_SALES_FIELDS.every((f) => layout.columns[f]);
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        {t.headerRow}
        <Select value={String(layout.headerRowIndex)} onValueChange={(v) => onChange({ headerRowIndex: Number(v), columns: {} })}>
          <SelectTrigger className="h-9 w-full text-sm text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {preview.topRows.map((row, i) => {
              const cells = row.map((c) => c.trim()).filter(Boolean);
              if (cells.length === 0) return null;
              return (
                <SelectItem key={i} value={String(i)}>
                  {format(t.rowLabel, { row: i + 1, cells: cells.slice(0, 6).join(' | ') })}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {MENU_SALES_FIELDS.map((field: MenuSalesField) => {
          const required = REQUIRED_MENU_SALES_FIELDS.includes(field);
          return (
            <label key={field} className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              <span>
                {t.fields[field]} {required && <span className="text-status-danger">· {t.required}</span>}
              </span>
              <Select value={layout.columns[field] ?? NONE} onValueChange={(v) => onChange({ ...layout, columns: { ...layout.columns, [field]: v === NONE ? undefined : v } })}>
                <SelectTrigger className={cn('h-9 w-full text-sm text-foreground', required && !layout.columns[field] && 'border-destructive')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!required && <SelectItem value={NONE}>{t.none}</SelectItem>}
                  {headerCells.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          );
        })}
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={onApply} disabled={!canApply || busy}>
          {t.apply}
        </Button>
      </div>
    </div>
  );
}
