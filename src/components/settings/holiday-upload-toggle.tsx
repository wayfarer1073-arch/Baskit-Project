'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useI18n } from '@/components/i18n/i18n-provider';

/** 공통: 주말·등록 휴무일에도 재고 업로드·실사 입력을 받을지 켜고 끈다. 꺼도 이미 올라온 휴무일 자료는 계산에 남는다. */
export function HolidayUploadToggle({ isAdmin, initial }: { isAdmin: boolean; initial: boolean }) {
  const { m } = useI18n();
  const t = m.settings.holidayUpload;
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function change(next: boolean) {
    setSaving(true);
    setOn(next);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowNonWorkingDayUploads: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(next ? t.on : t.off);
      router.refresh();
    } catch {
      setOn(!next);
      toast.error(t.failed);
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
      <CardContent className="flex items-center gap-2.5">
        <Switch id="allow-non-working-day-uploads" checked={on} onCheckedChange={change} disabled={!isAdmin || saving} />
        <Label htmlFor="allow-non-working-day-uploads">{t.label}</Label>
      </CardContent>
    </Card>
  );
}
