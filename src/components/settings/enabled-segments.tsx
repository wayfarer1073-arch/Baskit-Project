'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { SEGMENT_ORDER, type Segment } from '@/lib/segments';

/**
 * 공통: 이 워크스페이스가 실제로 쓰는 대시보드 방식을 켜고 끈다. 끈 방식은 메뉴·설정 탭·캘린더 입력에서
 * 사라질 뿐 데이터는 지우지 않으므로, 다시 켜면 그대로 돌아온다. 하나는 반드시 켜 두어야 한다.
 */
export function EnabledSegments({ isAdmin, enabled: initial }: { isAdmin: boolean; enabled: Segment[] }) {
  const { m } = useI18n();
  const t = m.settingsScreens.segmentsToggle;
  const router = useRouter();
  const [enabled, setEnabled] = useState<Segment[]>(initial);
  const [saving, setSaving] = useState(false);

  async function toggle(segment: Segment, on: boolean) {
    const next = on ? SEGMENT_ORDER.filter((s) => s === segment || enabled.includes(s)) : enabled.filter((s) => s !== segment);
    if (next.length === 0) {
      toast.error(t.needOne);
      return;
    }
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    try {
      const res = await fetch('/api/workspace/segments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: SEGMENT_ORDER.filter((s) => !next.includes(s)) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error);
      toast.success(format(on ? t.turnedOn : t.turnedOff, { name: m.segments[segment].label }));
      router.refresh();
    } catch (e) {
      setEnabled(previous);
      toast.error(e instanceof Error && e.message ? e.message : t.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        {SEGMENT_ORDER.map((segment) => {
          const on = enabled.includes(segment);
          const last = on && enabled.length === 1;
          return (
            <div key={segment} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <Label htmlFor={`segment-toggle-${segment}`} className="flex flex-col items-start gap-0.5">
                <span className="text-sm font-medium">{m.segments[segment].label}</span>
                <span className="text-xs font-normal text-muted-foreground">{m.segments[segment].audience}</span>
              </Label>
              <Switch
                id={`segment-toggle-${segment}`}
                checked={on}
                onCheckedChange={(v) => toggle(segment, v)}
                disabled={!isAdmin || saving || last}
                title={last ? t.needOne : undefined}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
