import Link from 'next/link';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { cn } from '@/lib/utils';

export function SegmentDashboardHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function SummaryPanel({ title, tooltip, children, footer }: { title: string; tooltip?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border" aria-label={title}>
      <div className="flex items-center gap-1.5 bg-sidebar px-5 py-3.5 text-sidebar-foreground">
        <h2 className="text-base font-semibold">{title}</h2>
        {tooltip && <InfoTooltip className="text-brand-accent hover:text-brand-accent/80">{tooltip}</InfoTooltip>}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 py-5 sm:grid-cols-4">{children}</div>
      {footer && <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">{footer}</div>}
    </section>
  );
}

export function SummaryMetric({ label, value, detail, emphasis }: { label: string; value: string; detail?: string; emphasis?: 'danger' | 'warning' | 'normal' }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tracking-tight tabular-nums',
          emphasis === 'danger' && 'text-status-danger',
          emphasis === 'warning' && 'text-status-warning',
          emphasis === 'normal' && 'text-status-normal',
        )}
      >
        {value}
      </p>
      {detail && <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

export function SectionPanel({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SegmentEmptyState({ title, description, href, cta }: { title: string; description: string; href: string; cta: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <p className="text-base font-semibold">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      <Link href={href} className="rounded-lg bg-brand-accent px-4 py-2 text-sm font-medium text-brand-accent-foreground transition-opacity hover:opacity-90">
        {cta}
      </Link>
    </div>
  );
}
