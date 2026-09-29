'use client';

import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/components/i18n/i18n-provider';

function InfoTooltip({ children, className }: { children: React.ReactNode; className?: string }) {
  const { m } = useI18n();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn('inline-flex shrink-0 items-center justify-center text-muted-foreground/70 transition-colors hover:text-foreground', className)}
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
