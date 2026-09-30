'use client';

import { useId } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';

/** 한눈에 많이 봐야 하는 표에 쓰는 10/20/50/100개 선택. 나머지 목록은 7개 고정(usePaged 기본값)이다. */
export const WIDE_PAGE_SIZES = [10, 20, 50, 100] as const;

export function PageSizeSelect({ value, onChange, className }: { value: number; onChange: (size: number) => void; className?: string }) {
  const { m } = useI18n();
  const labelId = useId();
  return (
    <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
      <span id={labelId}>{m.dashboard.ui.rowsPerPage}</span>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="h-8 w-[84px] text-xs" aria-labelledby={labelId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WIDE_PAGE_SIZES.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {format(m.dashboard.ui.rowsOption, { count: n })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
