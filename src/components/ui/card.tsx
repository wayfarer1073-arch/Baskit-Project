import * as React from 'react';
import { cn } from '@/lib/utils';
import { InfoTooltip } from '@/components/ui/info-tooltip';

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card" className={cn('overflow-hidden rounded-xl border border-border bg-card text-card-foreground', className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex flex-row flex-wrap items-center gap-1.5 bg-sidebar px-5 py-3.5 text-sidebar-foreground', className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-title" className={cn('text-base font-semibold leading-none', className)} {...props} />;
}

/** 카드 설명은 머리글에 문장으로 늘어놓지 않고 제목 옆 라임색 느낌표(툴팁)로 보여준다. */
function CardDescription({ children }: { children?: React.ReactNode; className?: string }) {
  return (
    <span data-slot="card-description" className="inline-flex">
      <InfoTooltip tone="header">{children}</InfoTooltip>
    </span>
  );
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-action" className={cn('ml-auto', className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('p-5', className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex items-center px-5 pb-5', className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter };
