'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { LAYOUT_FIELDS, type ImportLayout } from '@/domain/excel/layout-types';
import { formatKstDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import { Paged } from '@/components/ui/paged';

export interface ImportTemplateView {
  id: string;
  name: string;
  layout: ImportLayout;
  lastUsedAt: string | null;
}

/** 저장된 업로드 양식 목록 — 이름을 누르면 어떤 열을 어떻게 읽는지 보여주고, 이름을 바꾸거나 지울 수 있다(지우면 그 양식은 다시 자동 인식으로 읽는다). */
export function ImportTemplateManagement({ templates }: { templates: ImportTemplateView[] }) {
  const { m } = useI18n();
  const t = m.templates;
  const router = useRouter();
  const [names, setNames] = useState(Object.fromEntries(templates.map((tpl) => [tpl.id, tpl.name])));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function call(id: string, init: RequestInit, success: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/import-templates/${id}`, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? t.failed);
      toast.success(success);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.failed);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {templates.length === 0 && <p className="text-sm text-muted-foreground">{t.empty}</p>}
        {templates.length > 0 && (
          <Paged items={templates} pagerClassName="mt-2">
            {(pageItems) => (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {pageItems.map((tpl) => {
                  const open = openId === tpl.id;
                  return (
                    <li key={tpl.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/50"
                        aria-expanded={open}
                        aria-controls={`template-${tpl.id}`}
                        onClick={() => setOpenId(open ? null : tpl.id)}
                      >
                        <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate font-medium">{tpl.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {format(t.columnCount, { count: LAYOUT_FIELDS.filter((f) => tpl.layout.columns[f]).length })}
                        </span>
                      </button>
                      {open && (
                        <div id={`template-${tpl.id}`} className="space-y-3 border-t border-border bg-muted/30 px-3 py-3">
                          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                            {LAYOUT_FIELDS.map((f) => {
                              const column = tpl.layout.columns[f];
                              if (!column && f !== 'productCode') return null;
                              return (
                                <Fragment key={f}>
                                  <dt className="text-muted-foreground">{m.layout.fields[f]}</dt>
                                  <dd className="min-w-0 truncate">{column ? format(t.fromColumn, { column }) : t.autoCode}</dd>
                                </Fragment>
                              );
                            })}
                            <dt className="text-muted-foreground">{t.position}</dt>
                            <dd>{[tpl.layout.sheetName, format(m.layout.rowLabel, { n: tpl.layout.headerRowIndex + 1 })].filter(Boolean).join(' · ')}</dd>
                            <dt className="text-muted-foreground">{m.layout.stockUnit}</dt>
                            <dd>{tpl.layout.stockUnit === 'BOX' ? m.layout.unitBOX : tpl.layout.stockUnit === 'PLT' ? m.layout.unitPLT : m.layout.unitEA}</dd>
                            <dt className="text-muted-foreground">{m.layout.zeroStock}</dt>
                            <dd>{tpl.layout.zeroStockAsSoldOut === false ? m.layout.zeroStockNo : m.layout.zeroStockYes}</dd>
                            <dt className="text-muted-foreground">{m.layout.duplicateMode}</dt>
                            <dd>{tpl.layout.duplicateMode === 'skip' ? m.layout.duplicateSkip : m.layout.duplicateSum}</dd>
                          </dl>
                          <p className="text-[11px] text-muted-foreground">{tpl.lastUsedAt ? format(t.lastUsed, { date: formatKstDate(tpl.lastUsedAt) }) : t.neverUsed}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <Input
                              aria-label={m.layout.templateName}
                              value={names[tpl.id] ?? ''}
                              maxLength={60}
                              onChange={(e) => setNames((p) => ({ ...p, [tpl.id]: e.target.value }))}
                              className="h-8 max-w-xs bg-background"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === tpl.id || !names[tpl.id]?.trim() || names[tpl.id] === tpl.name}
                              onClick={() =>
                                call(tpl.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: names[tpl.id] }) }, t.saved)
                              }
                            >
                              {t.rename}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-auto text-destructive"
                              disabled={busyId === tpl.id}
                              onClick={() => confirm(format(t.removeConfirm, { name: tpl.name })) && call(tpl.id, { method: 'DELETE' }, t.removed)}
                            >
                              <Trash2 className="size-3.5" /> {t.remove}
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Paged>
        )}
      </CardContent>
    </Card>
  );
}
