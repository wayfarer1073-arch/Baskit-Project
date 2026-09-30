'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, KeyRound, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SectionPanel, SummaryMetric, SummaryPanel } from '@/components/segment-dashboards/dashboard-parts';
import { AuditLogPanel, dataSummary, WorkspaceBadges } from '@/components/platform/platform-console';
import { adminRequest, enterWorkspace } from '@/components/platform/workspace-actions';
import { timeAgo } from '@/components/platform/format';
import type { AuditLogRow, WorkspaceSummary, WorkspaceUserRow, WorkspaceWarehouseRow } from '@/domain/platform/read-model';
import { SEGMENT_ORDER, isSegment } from '@/lib/segments';
import { formatKstDateTime } from '@/lib/date';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { Paged } from '@/components/ui/paged';

interface WorkspaceDetailProps {
  summary: WorkspaceSummary;
  users: WorkspaceUserRow[];
  warehouses: WorkspaceWarehouseRow[];
  auditLogs: AuditLogRow[];
  homeOrgId: string;
}

export function WorkspaceDetail({ summary: w, users, warehouses, auditLogs, homeOrgId }: WorkspaceDetailProps) {
  const { m } = useI18n();
  const t = m.platform.detail;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(w.name);
  const [confirmName, setConfirmName] = useState('');
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);
  const protectedOrg = w.hasPlatformAdmin || w.id === homeOrgId;

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.requestFailed);
    } finally {
      setBusy(false);
    }
  }

  const patch = (body: unknown, success: string) => run(() => adminRequest(`/api/admin/workspaces/${w.id}`, 'PATCH', body), success);

  async function remove() {
    setBusy(true);
    try {
      await adminRequest(`/api/admin/workspaces/${w.id}`, 'DELETE', { confirmName });
      toast.success(t.deleted);
      router.push('/admin');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.deleteFailed);
      setBusy(false);
    }
  }

  async function resetPassword(user: WorkspaceUserRow) {
    if (!confirm(format(t.resetConfirm, { email: user.email }))) return;
    setBusy(true);
    try {
      const { tempPassword: password } = await adminRequest<{ tempPassword: string }>(`/api/admin/users/${user.id}/reset-password`, 'POST');
      setTempPassword({ email: user.email, password });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.resetFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t.back}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{w.name}</h1>
            <WorkspaceBadges w={w} homeOrgId={homeOrgId} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {format(t.created, { date: formatKstDateTime(w.createdAt), owner: w.ownerEmail ?? m.platform.console.noUsers })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => enterWorkspace(w.id, router).catch((e) => toast.error(e.message))} disabled={busy}>
            <LogIn className="size-4" />
            {m.platform.console.enter}
          </Button>
          {!protectedOrg &&
            (w.suspendedAt ? (
              <Button variant="outline" disabled={busy} onClick={() => patch({ suspended: false }, t.unsuspended)}>
                {t.unsuspend}
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => confirm(t.suspendConfirm) && patch({ suspended: true }, t.suspendedToast)}
              >
                {t.suspend}
              </Button>
            ))}
        </div>
      </div>

      <SummaryPanel title={t.summaryTitle}>
        <SummaryMetric label={t.users} value={format(t.usersValue, { count: w.userCount })} detail={format(t.lastLogin, { time: timeAgo(w.lastLoginAt, m.platform.time) })} />
        <SummaryMetric label={t.lastActivity} value={timeAgo(w.lastActivityAt, m.platform.time)} detail={t.activitySources} />
        <SummaryMetric label={t.warehouses} value={format(m.platform.console.count, { count: w.warehouseCount })} detail={dataSummary(w, m.platform.data)} />
        <SummaryMetric
          label={t.usage}
          value={format(t.uploads, { count: w.uploads30d })}
          detail={format(t.usageDetail, { users: w.activeUsers30d, rows: w.storedRows.toLocaleString() }) + (w.pendingInvites ? format(t.pendingInvites, { count: w.pendingInvites }) : '')}
        />
        <SummaryMetric
          label={t.status}
          value={w.suspendedAt ? t.statusSuspended : t.statusActive}
          emphasis={w.suspendedAt ? 'danger' : 'normal'}
          detail={w.suspendedAt ? format(t.suspendedAt, { date: formatKstDateTime(w.suspendedAt) }) : undefined}
        />
      </SummaryPanel>

      <SectionPanel title={t.infoTitle}>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              patch({ name }, t.renamed);
            }}
          >
            <Label htmlFor="ws-name">{t.name}</Label>
            <div className="flex gap-2">
              <Input id="ws-name" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" variant="outline" disabled={busy || name.trim() === '' || name === w.name}>
                {t.save}
              </Button>
            </div>
          </form>
          <div className="space-y-1.5">
            <Label htmlFor="ws-segment">{t.segment}</Label>
            <Select value={w.segment} onValueChange={(v) => isSegment(v) && patch({ segment: v }, t.segmentChanged)}>
              <SelectTrigger id="ws-segment" className="w-full" disabled={busy}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEGMENT_ORDER.map((v) => (
                  <SelectItem key={v} value={v}>
                    {m.segments[v].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t.segmentHelp}</p>
          </div>
        </div>
      </SectionPanel>

      <SectionPanel title={t.users} description={format(t.usersValue, { count: users.length })}>
        {tempPassword && (
          <div role="status" className="border-b border-border bg-status-warning-bg px-5 py-3 text-sm">
            <p>
              <strong>{tempPassword.email}</strong>
              {t.tempPassword}
              <code className="rounded bg-background px-1.5 py-0.5 font-mono">{tempPassword.password}</code>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t.tempPasswordHelp}</p>
          </div>
        )}
        <Paged items={users} pagerClassName="border-t border-border px-5 py-2.5">
          {(pageItems) => (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.cols.user}</TableHead>
                    <TableHead>{t.cols.role}</TableHead>
                    <TableHead>{t.cols.created}</TableHead>
                    <TableHead>{t.cols.lastLogin}</TableHead>
                    <TableHead>{t.cols.status}</TableHead>
                    <TableHead className="text-right">{t.cols.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageItems.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {u.role === 'ADMIN' ? m.nav.roles.admin : u.role === 'VIEWER' ? m.nav.roles.viewer : m.nav.roles.member}
                        {u.isPlatformAdmin && (
                          <Badge variant="notice" className="ml-1.5">
                            {t.operator}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{formatKstDateTime(u.createdAt).slice(0, 10)}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{timeAgo(u.lastLoginAt, m.platform.time)}</TableCell>
                      <TableCell>{u.isActive ? <Badge variant="normal">{t.active}</Badge> : <Badge variant="stagnant">{t.inactive}</Badge>}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {!u.isPlatformAdmin && (
                          <>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => resetPassword(u)}>
                              <KeyRound className="size-3.5" />
                              {t.issueTemp}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => run(() => adminRequest(`/api/admin/users/${u.id}`, 'PATCH', { isActive: !u.isActive }), u.isActive ? t.deactivated : t.activated)}
                            >
                              {u.isActive ? t.deactivate : t.activate}
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {users.length === 0 && <p className="px-5 py-6 text-center text-sm text-muted-foreground">{t.noUsers}</p>}
            </div>
          )}
        </Paged>
      </SectionPanel>

      {warehouses.length > 0 && (
        <SectionPanel title={t.warehouses} description={format(t.warehouseCount, { count: warehouses.length })}>
          <Paged items={warehouses} pagerClassName="border-t border-border px-5 py-2.5">
            {(pageItems) => (
              <ul className="divide-y divide-border">
                {pageItems.map((wh) => (
                  <li key={wh.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="w-8 rounded bg-muted px-1.5 py-0.5 text-center text-[11px] font-medium text-muted-foreground">{wh.code}</span>
                    <span className="min-w-0 flex-1 truncate">{wh.name}</span>
                    {wh.isArchived && <Badge variant="stagnant">{t.archived}</Badge>}
                    <span className="text-xs text-muted-foreground">
                      {format(t.warehouseLine, { skus: wh.skuCount, date: wh.lastSnapshotDate ?? t.none })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Paged>
        </SectionPanel>
      )}

      <AuditLogPanel logs={auditLogs} title={t.auditTitle} />

      <section className="rounded-xl border border-status-danger/40" aria-label={t.deleteTitle}>
        <div className="border-b border-status-danger/30 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-status-danger">{t.deleteTitle}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {protectedOrg ? t.deleteProtected : t.deleteWarning}
          </p>
        </div>
        {!protectedOrg && (
          <div className="flex flex-wrap items-center gap-2 px-5 py-4">
            <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={w.name} className="max-w-xs" aria-label={t.deleteConfirmAria} />
            <Button variant="destructive" disabled={busy || confirmName !== w.name} onClick={remove}>
              {t.deleteForever}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
