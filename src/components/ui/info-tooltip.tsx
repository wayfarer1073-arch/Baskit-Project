'use client';

import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/components/i18n/i18n-provider';

/** 매트블랙 머리글 안에 쓰는 라임색 느낌표. */
export const HEADER_TIP_CLASS = 'text-brand-accent hover:text-brand-accent/80';

function InfoTooltip({ children, className, tone = 'default' }: { children: React.ReactNode; className?: string; tone?: 'default' | 'header' }) {
  const { m } = useI18n();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn('inline-flex shrink-0 items-center justify-center transition-colors', tone === 'header' ? HEADER_TIP_CLASS : 'text-muted-foreground/70 hover:text-foreground', className)}
          aria-label={m.dashboard.ui.moreInfo}
        >
          <CircleAlert className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-left">{children}</TooltipContent>
    </Tooltip>
  );
}

export { InfoTooltip };
