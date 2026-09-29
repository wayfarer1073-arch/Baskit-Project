'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogIn, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SectionPanel, SegmentDashboardHeader, SummaryMetric, SummaryPanel } from '@/components/segment-dashboards/dashboard-parts';
import { SignupChart } from '@/components/platform/signup-chart';
import { adminRequest, enterWorkspace } from '@/components/platform/workspace-actions';
import { timeAgo } from '@/components/platform/format';
import { type AuditLogRow, type PlatformMetrics, type WorkspaceSummary } from '@/domain/platform/read-model';
import { SEGMENT_ORDER, type Segment } from '@/lib/segments';
import type { Messages } from '@/lib/i18n/messages';
import { formatKstDateTime } from '@/lib/date';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

type StatusFilter = 'all' | 'active' | 'suspended' | 'demo';

interface PlatformConsoleProps {
  metrics: PlatformMetrics;
  workspaces: WorkspaceSummary[];
  auditLogs: AuditLogRow[];
  homeOrgId: string;
}

export function dataSummary(w: WorkspaceSummary, t: Messages['platform']['data']) {
  if (w.segment === 'ORDER_CYCLE') return format(t.store, { items: w.storeItemCount, orders: w.orderCount, days: w.salesDays });
  return format(t.stock, { skus: w.skuCount, snapshots: w.snapshotCount, uploads: w.uploads30d });
}

export function WorkspaceBadges({ w, homeOrgId }: { w: WorkspaceSummary; homeOrgId: string }) {
  const t = useI18n().m.platform.badges;
  return (
    <>
      {w.id === homeOrgId && <Badge variant="notice">{t.mine}</Badge>}
      {w.isDemo && <Badge variant="increase">{t.demo}</Badge>}
      {w.suspendedAt && <Badge variant="danger">{t.suspended}</Badge>}
    </>
  );
}

export function PlatformConsole({ metrics, workspaces, auditLogs, homeOrgId }: PlatformConsoleProps) {
  const { m } = useI18n();
  const t = m.platform.console;
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState<'all' | Segment>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workspaces.filter(
      (w) =>
        (segment === 'all' || w.segment === segment) &&
        (status === 'all' ||
          (status === 'suspended' && w.suspendedAt) ||
          (status === 'demo' && w.isDemo) ||
          (status === 'active' && !w.suspendedAt && !w.isDemo)) &&
        (!q || `${w.name} ${w.ownerEmail ?? ''} ${w.ownerName ?? ''}`.toLowerCase().includes(q)),
    );
  }, [workspaces, query, segment, status]);

  async function enter(id: string) {
    setBusy(id);
    try {
      await enterWorkspace(id, router);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.enterFailed);
      setBusy(null);
    }
  }

  async function createDemo(value: Segment, thenEnter: boolean) {
    setBusy(`demo-${value}`);
    try {
      const { workspace } = await adminRequest<{ workspace: { id: string; name: string } }>('/api/admin/workspaces', 'POST', { segment: value });
      toast.success(format(t.created, { name: workspace.name }));
      if (thenEnter) await enterWorkspace(workspace.id, router);
      else router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.createFailed);
    } finally {
      setBusy(null);
    }
  }

  const total = metrics.workspaceCount || 1;

  return (
    <div className="space-y-6">
      <SegmentDashboardHeader title={t.title} description={t.description} />

      <SummaryPanel title={t.summaryTitle} tooltip={t.summaryTip}>
        <SummaryMetric label={t.workspaces} value={format(t.count, { count: metrics.workspaceCount })} detail={format(t.workspacesDetail, { users: metrics.userCount, demos: metrics.demoCount })} />
        <SummaryMetric label={t.signups} value={format(t.count, { count: metrics.signups7d })} detail={format(t.signupsDetail, { count: metrics.signups30d })} emphasis={metrics.signups7d ? 'normal' : undefined} />
        <SummaryMetric label={t.active} value={format(t.count, { count: metrics.active7d })} detail={format(t.activeDetail, { pct: Math.round((metrics.active7d / total) * 100) })} />
        <SummaryMetric label={t.suspended} value={format(t.count, { count: metrics.suspendedCount })} emphasis={metrics.suspendedCount ? 'danger' : undefined} />
      </SummaryPanel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <SectionPanel title={t.signupTrend} description={t.signupTrendDescription}>
          <div className="px-3 pt-3 pb-2">
            <SignupChart data={metrics.signupsByDay} />
          </div>
        </SectionPanel>
        <SectionPanel title={t.segmentShare} description={t.segmentShareDescription}>
          <ul className="space-y-3 px-5 py-4">
            {SEGMENT_ORDER.map((value) => {
              const count = metrics.bySegment[value];
              return (
                <li key={value}>
                  <div className="flex items-center justify-between text-sm">
                    <span>{m.segments[value].label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {format(t.segmentCount, { count, pct: Math.round((count / total) * 100) })}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-chart-1" style={{ width: `${(count / total) * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </SectionPanel>
      </div>

      <SectionPanel title={t.demoTitle} description={t.demoDescription}>
        <div className="grid gap-3 px-5 py-4 md:grid-cols-3">
          {SEGMENT_ORDER.map((value) => (
            <div key={value} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div>
                <p className="text-sm font-semibold">{m.segments[value].label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{m.segments[value].audience}</p>
              </div>
              <div className="mt-auto flex gap-2">
                <Button size="sm" onClick={() => createDemo(value, true)} disabled={busy !== null}>
                  <Plus className="size-3.5" />
                  {busy === `demo-${value}` ? t.creating : t.createEnter}
                </Button>
                <Button size="sm" variant="outline" onClick={() => createDemo(value, false)} disabled={busy !== null}>
                  {t.createOnly}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </SectionPanel>

      <SectionPanel
        title={t.listTitle}
        description={format(t.listDescription, { shown: filtered.length, total: workspaces.length })}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.searchPlaceholder} className="h-8 w-44 pl-8 text-sm" aria-label={t.searchAria} />
            </div>
            <Select value={segment} onValueChange={(v) => setSegment(v as 'all' | Segment)}>
              <SelectTrigger className="h-8 w-36 text-sm" aria-label={t.segmentAria}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.allSegments}</SelectItem>
                {SEGMENT_ORDER.map((v) => (
                  <SelectItem key={v} value={v}>
                    {m.segments[v].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="h-8 w-28 text-sm" aria-label={t.statusAria}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.allStatus}</SelectItem>
                <SelectItem value="active">{t.statusActive}</SelectItem>
                <SelectItem value="suspended">{t.statusSuspended}</SelectItem>
                <SelectItem value="demo">{t.statusDemo}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.cols.workspace}</TableHead>
                <TableHead>{t.cols.segment}</TableHead>
                <TableHead>{t.cols.created}</TableHead>
                <TableHead className="text-right">{t.cols.users}</TableHead>
                <TableHead>{t.cols.data}</TableHead>
                <TableHead>{t.cols.activity}</TableHead>
                <TableHead className="text-right">{t.cols.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="max-w-72">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/admin/workspaces/${w.id}`} className="truncate text-sm font-medium underline-offset-4 hover:underline">
                        {w.name}
                      </Link>
                      <WorkspaceBadges w={w} homeOrgId={homeOrgId} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{w.ownerEmail ?? t.noUsers}</p>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{m.segments[w.segment].label}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap" title={formatKstDateTime(w.createdAt)}>
                    {timeAgo(w.createdAt, m.platform.time)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{w.userCount}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{dataSummary(w, m.platform.data)}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{timeAgo(w.lastActivityAt, m.platform.time)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => enter(w.id)} disabled={busy !== null} aria-label={format(t.enterAria, { name: w.name })}>
                      <LogIn className="size-3.5" />
                      {busy === w.id ? t.opening : t.enter}
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/admin/workspaces/${w.id}`}>{t.detail}</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t.noMatch}</p>}
        </div>
      </SectionPanel>

      <AuditLogPanel logs={auditLogs} />
    </div>
  );
}

export function AuditLogPanel({ logs, title }: { logs: AuditLogRow[]; title?: string }) {
  const { m } = useI18n();
  const t = m.platform.console;
  const actions = m.platform.actions as Record<string, string>;
  return (
    <SectionPanel title={title ?? t.auditTitle} description={t.auditDescription}>
      <ul className="divide-y divide-border">
        {logs.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted-foreground">{t.auditEmpty}</li>}
        {logs.map((log) => {
          const detail = log.detail && typeof log.detail === 'object' ? (log.detail as Record<string, unknown>) : null;
          return (
            <li key={log.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-5 py-2.5 text-sm">
              <span className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground">{formatKstDateTime(log.createdAt)}</span>
              <span className="font-medium">{actions[log.action] ?? log.action}</span>
              {log.organizationName && <span className="text-muted-foreground">{log.organizationName}</span>}
              {typeof detail?.email === 'string' && <span className="text-muted-foreground">· {detail.email}</span>}
              <span className="ml-auto text-xs text-muted-foreground">{log.actorEmail}</span>
            </li>
          );
        })}
      </ul>
    </SectionPanel>
  );
}
