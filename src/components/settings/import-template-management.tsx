'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { LAYOUT_FIELDS, type ImportLayout } from '@/domain/excel/layout-types';
import { formatKstDate } from '@/lib/date';

export interface ImportTemplateView {
  id: string;
  name: string;
  layout: ImportLayout;
  lastUsedAt: string | null;
}

/** 저장된 업로드 양식 목록 — 이름을 바꾸거나 지울 수 있다(지우면 그 양식은 다시 자동 인식으로 읽는다). */
export function ImportTemplateManagement({ templates }: { templates: ImportTemplateView[] }) {
  const { m } = useI18n();
  const t = m.templates;
  const router = useRouter();
  const [names, setNames] = useState(Object.fromEntries(templates.map((tpl) => [tpl.id, tpl.name])));
  const [busyId, setBusyId] = useState<string | null>(null);

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
        {templates.map((tpl) => {
          const mapped = LAYOUT_FIELDS.filter((f) => tpl.layout.columns[f]).map((f) => `${m.layout.fields[f]} ← ${tpl.layout.columns[f]}`);
          return (
            <div key={tpl.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label={m.layout.templateName}
                  value={names[tpl.id] ?? ''}
                  maxLength={60}
                  onChange={(e) => setNames((p) => ({ ...p, [tpl.id]: e.target.value }))}
                  className="h-8 max-w-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === tpl.id || !names[tpl.id]?.trim() || names[tpl.id] === tpl.name}
                  onClick={() => call(tpl.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: names[tpl.id] }) }, t.saved)}
                >
                  {t.rename}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-auto"
                  aria-label={`${tpl.name} ${t.remove}`}
                  disabled={busyId === tpl.id}
                  onClick={() => confirm(format(t.removeConfirm, { name: tpl.name })) && call(tpl.id, { method: 'DELETE' }, t.removed)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {[tpl.layout.sheetName, format(m.layout.rowLabel, { n: tpl.layout.headerRowIndex + 1 })].filter(Boolean).join(' · ')} · {mapped.join(' · ')}
              </p>
              <p className="text-[11px] text-muted-foreground">{tpl.lastUsedAt ? format(t.lastUsed, { date: formatKstDate(tpl.lastUsedAt) }) : t.neverUsed}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
