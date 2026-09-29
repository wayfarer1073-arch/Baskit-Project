'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Settings2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { LAYOUT_FIELDS, REQUIRED_LAYOUT_FIELDS, type ImportLayout, type LayoutField, type MatchConfidence } from '@/domain/excel/layout-types';
import { cn } from '@/lib/utils';

/** 서버 미리보기 응답(upload-service의 UploadPreview와 같은 모양). */
export interface LayoutPreview {
  sheets: { name: string; rowCount: number }[];
  layout: ImportLayout;
  template: { id: string; name: string } | null;
  confidence: Partial<Record<LayoutField, MatchConfidence>>;
  topRows: string[][];
  headers: string[];
  rowCount: number;
  sample: { productCode: string; productName: string; normalStock: number; unitCost: number | null }[];
  fileDates: string[];
  issues: { level: 'ERROR' | 'WARNING'; code: string; message: string }[];
  newCodes: string[];
}

const colLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);

interface LayoutReviewProps {
  preview: LayoutPreview | null;
  loading: boolean;
  date: string;
  onLayoutChange: (layout: ImportLayout) => void;
  saveTemplate: boolean;
  onSaveTemplateChange: (value: boolean) => void;
  templateName: string;
  onTemplateNameChange: (value: string) => void;
}

/**
 * 업로드 전에 파일 양식을 보여준다. 저장된 템플릿이 맞으면 한 줄 요약만, 아니면 열 지정 편집을 펼쳐 둔다.
 * 무엇을 바꾸든 서버가 같은 파서로 다시 읽은 미리보기를 보여준다 — 화면과 실제 저장 결과가 어긋나지 않도록.
 */
export function LayoutReview({ preview, loading, date, onLayoutChange, saveTemplate, onSaveTemplateChange, templateName, onTemplateNameChange }: LayoutReviewProps) {
  const { m } = useI18n();
  const t = m.layout;
  const [editing, setEditing] = useState(false);
  // 체크했지만 아직 열을 고르지 않은 항목(열을 고르면 레이아웃에 들어간다).
  const [opened, setOpened] = useState<Set<LayoutField>>(new Set());

  if (!preview) {
    return loading ? (
      <div className="space-y-2 rounded-md border border-border p-3" aria-busy="true">
        <p className="text-xs text-muted-foreground">{t.analyzing}</p>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    ) : null;
  }

  const { layout } = preview;
  const errors = preview.issues.filter((i) => i.level === 'ERROR');
  const warnings = preview.issues.filter((i) => i.level === 'WARNING' && i.code !== 'COST_MISSING');
  // 자동 인식이 확실하면 접어 두고, 필요할 때 '양식 설정'으로 연다. 오류가 있으면 항상 연다.
  const autoConfident = !preview.template && Object.values(preview.confidence).every((c) => c === 'exact');
  const showEditor = editing ? true : errors.length > 0 || (!preview.template && !autoConfident);
  const set = (patch: Partial<ImportLayout>) => onLayoutChange({ ...layout, ...patch });
  const setColumn = (field: LayoutField, header: string | null) => set({ columns: { ...layout.columns, [field]: header } });
  const toggleField = (field: LayoutField, on: boolean) => {
    setOpened((prev) => {
      const next = new Set(prev);
      if (on) next.add(field);
      else next.delete(field);
      return next;
    });
    if (!on && layout.columns[field]) setColumn(field, null);
  };
  const headerOptions = preview.headers.map((h, i) => ({ value: h, label: `${colLetter(i)} · ${h}` })).filter((o) => o.value.trim() !== '');
  const dateNote =
    preview.fileDates.length > 1
      ? format(t.multipleDates, { dates: preview.fileDates.slice(0, 3).join(', ') })
      : preview.fileDates.length === 1 && preview.fileDates[0] !== date
        ? format(t.dateMismatch, { fileDate: preview.fileDates[0], date })
        : null;

  return (
    <section aria-label={t.title} className={cn('space-y-3 rounded-md border p-3', loading && 'opacity-60')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          {preview.template ? (
            <CheckCircle2 className="size-3.5 text-status-normal" aria-hidden="true" />
          ) : (
            <Settings2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
          )}
          {preview.template ? format(t.templateApplied, { name: preview.template.name }) : t.autoDetected}
        </p>
        {errors.length === 0 && (
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setEditing((v) => !v)} aria-expanded={showEditor}>
            <Settings2 className="size-3.5" aria-hidden="true" />
            {showEditor ? t.hideEdit : t.settingsButton}
          </Button>
        )}
      </div>

      {showEditor && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {preview.sheets.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs">{t.sheet}</Label>
                <Select value={layout.sheetName ?? preview.sheets[0].name} onValueChange={(v) => set({ sheetName: v, headerRowIndex: 0, columns: {} })}>
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {preview.sheets.map((s) => (
                      <SelectItem key={s.name} value={s.name}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">{t.headerRow}</Label>
              <Select value={String(layout.headerRowIndex)} onValueChange={(v) => set({ headerRowIndex: Number(v), columns: {} })}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {preview.topRows.map((row, i) => (
                    <SelectItem key={i} value={String(i)}>
                      <span className="text-muted-foreground">{format(t.rowLabel, { n: i + 1 })}</span>{' '}
                      <span className="truncate">
                        {row
                          .filter((c) => c.trim() !== '')
                          .slice(0, 4)
                          .join(' · ')}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">{t.columnsTitle}</legend>
            <p className="text-[11px] text-muted-foreground">{t.columnsHint}</p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {LAYOUT_FIELDS.map((field) => {
                const required = REQUIRED_LAYOUT_FIELDS.includes(field);
                const value = layout.columns[field] ?? null;
                const checked = required || value !== null || opened.has(field);
                const confidence = value ? preview.confidence[field] : undefined;
                const id = `layout-field-${field}`;
                const hint = (t.fieldHints as Partial<Record<LayoutField, string>>)[field];
                return (
                  <li key={field} className="grid grid-cols-1 gap-1.5 px-2.5 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-center">
                    <label className="flex items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-3.5 accent-[var(--brand-accent)]"
                        checked={checked}
                        disabled={required}
                        aria-describedby={hint ? `${id}-hint` : undefined}
                        onChange={(e) => toggleField(field, e.target.checked)}
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5 font-medium">
                          {t.fields[field]}
                          {required && <span className="text-[10px] font-normal text-muted-foreground">{t.required}</span>}
                          {confidence && (
                            <Badge variant={confidence === 'guess' ? 'warning' : 'secondary'} className="h-4 px-1 text-[10px] font-normal">
                              {t.confidence[confidence]}
                            </Badge>
                          )}
                        </span>
                        {hint && (
                          <span id={`${id}-hint`} className="block text-[11px] font-normal text-muted-foreground">
                            {hint}
                          </span>
                        )}
                      </span>
                    </label>
                    {checked && (
                      <Select value={value ?? undefined} onValueChange={(v) => setColumn(field, v)}>
                        <SelectTrigger id={id} aria-label={t.fields[field]} className={cn('h-8 w-full text-xs', !value && 'border-destructive')}>
                          <SelectValue placeholder={t.chooseColumn} />
                        </SelectTrigger>
                        <SelectContent>
                          {headerOptions.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">{t.stockUnit}</Label>
              <Select value={layout.stockUnit ?? 'EA'} onValueChange={(v) => set({ stockUnit: v === 'BOX' || v === 'PLT' ? v : 'EA' })}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EA">{t.unitEA}</SelectItem>
                  <SelectItem value="BOX">{t.unitBOX}</SelectItem>
                  <SelectItem value="PLT">{t.unitPLT}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t.duplicateMode}</Label>
              <Select value={layout.duplicateMode} onValueChange={(v) => set({ duplicateMode: v === 'skip' ? 'skip' : 'sum' })}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sum">{t.duplicateSum}</SelectItem>
                  <SelectItem value="skip">{t.duplicateSkip}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {showEditor && (
        <fieldset className="space-y-1.5 rounded-md border border-border p-2.5">
          <legend className="px-1 text-xs font-medium">{t.zeroStock}</legend>
          {([true, false] as const).map((yes) => (
            <label key={String(yes)} className="flex items-start gap-2 text-xs">
              <input
                type="radio"
                name="zero-stock-mode"
                className="mt-0.5 accent-[var(--brand-accent)]"
                checked={(layout.zeroStockAsSoldOut ?? true) === yes}
                onChange={() => set({ zeroStockAsSoldOut: yes })}
              />
              <span>
                <span className="font-medium">{yes ? t.zeroStockYes : t.zeroStockNo}</span>
                <span className="block text-[11px] text-muted-foreground">{yes ? t.zeroStockYesHint : t.zeroStockNoHint}</span>
              </span>
            </label>
          ))}
          <p className="text-[11px] text-muted-foreground">{t.zeroStockPast}</p>
        </fieldset>
      )}

      {errors.length > 0 ? (
        <div role="alert" className="rounded-md bg-status-danger-bg p-2.5 text-xs text-status-danger">
          <p className="mb-1 flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            {t.fixErrors}
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {errors.slice(0, 5).map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div>
          <p className="mb-1 text-xs font-medium">{format(t.previewTitle, { count: preview.rowCount.toLocaleString() })}</p>
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">{t.colCode}</th>
                  <th className="px-2 py-1 text-left font-medium">{t.colName}</th>
                  <th className="px-2 py-1 text-right font-medium">{t.colStock}</th>
                  <th className="px-2 py-1 text-right font-medium">{t.colCost}</th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.slice(0, 5).map((r) => (
                  <tr key={r.productCode} className="border-t border-border">
                    <td className="px-2 py-1 tabular-nums">{r.productCode}</td>
                    <td className="max-w-48 truncate px-2 py-1">{r.productName}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.normalStock.toLocaleString()}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{r.unitCost === null ? '—' : r.unitCost.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(dateNote || warnings.length > 0 || preview.newCodes.length > 0) && (
        <div className="space-y-1 text-xs text-status-warning">
          {dateNote && <p>{dateNote}</p>}
          {preview.newCodes.length > 0 && (
            <p>{format(t.newCodes, { count: preview.newCodes.length, codes: preview.newCodes.slice(0, 5).join(', ') + (preview.newCodes.length > 5 ? ' …' : '') })}</p>
          )}
          {warnings.length > 0 && (
            <details>
              <summary className="cursor-pointer">{format(t.warningsCount, { count: warnings.length })}</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                {warnings.slice(0, 8).map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {!preview.template && errors.length === 0 && (
        <div className="space-y-1.5 border-t border-border pt-2.5">
          <p className="text-[11px] text-muted-foreground">{t.templateNameHint}</p>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={saveTemplate} onChange={(e) => onSaveTemplateChange(e.target.checked)} className="accent-[var(--brand-accent)]" />
            {t.saveTemplate}
          </label>
          {saveTemplate && (
            <Input aria-label={t.templateName} value={templateName} maxLength={60} onChange={(e) => onTemplateNameChange(e.target.value)} className="h-8 text-xs sm:w-72" />
          )}
        </div>
      )}
    </section>
  );
}
