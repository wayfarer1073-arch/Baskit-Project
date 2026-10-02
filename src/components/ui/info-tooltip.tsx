'use client';

import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/components/i18n/i18n-provider';

/** 매트블랙 머리글 안에 쓰는 라임색 느낌표. */
export const HEADER_TIP_CLASS = 'text-brand-accent hover:text-brand-accent/80';

const TONE_CLASS = {
  default: 'text-muted-foreground/70 hover:text-foreground',
  header: HEADER_TIP_CLASS,
  /** 추정치처럼 실제 값이 아님을 알려야 할 때 쓰는 붉은 느낌표. */
  alert: 'text-status-danger hover:text-status-danger/80',
};

function InfoTooltip({
  children,
  className,
  tone = 'default',
  label,
}: {
  children: React.ReactNode;
  className?: string;
  tone?: keyof typeof TONE_CLASS;
  label?: string;
}) {
  const { m } = useI18n();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn('inline-flex shrink-0 items-center justify-center transition-colors', TONE_CLASS[tone], className)}
          aria-label={label ?? m.dashboard.ui.moreInfo}
        >
          <CircleAlert className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-left">{children}</TooltipContent>
    </Tooltip>
  );
}

export { InfoTooltip };
