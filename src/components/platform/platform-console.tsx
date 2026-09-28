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
import { AUDIT_ACTION_LABEL, type AuditLogRow, type PlatformMetrics, type WorkspaceSummary } from '@/domain/platform/read-model';
import { SEGMENT_META, SEGMENT_ORDER, type Segment } from '@/lib/segments';
import { formatKstDateTime } from '@/lib/date';

type StatusFilter = 'all' | 'active' | 'suspended' | 'demo';

interface PlatformConsoleProps {
  metrics: PlatformMetrics;
  workspaces: WorkspaceSummary[];
  auditLogs: AuditLogRow[];
  homeOrgId: string;
}

export function dataSummary(w: WorkspaceSummary) {
  if (w.segment === 'ORDER_CYCLE') return `품목 ${w.storeItemCount} · 발주 ${w.orderCount} · 매출 ${w.salesDays}일`;
  return `SKU ${w.skuCount} · 스냅샷 ${w.snapshotCount}`;
}

export function WorkspaceBadges({ w, homeOrgId }: { w: WorkspaceSummary; homeOrgId: string }) {
  return (
    <>
      {w.id === homeOrgId && <Badge variant="notice">내 워크스페이스</Badge>}
      {w.isDemo && <Badge variant="increase">데모</Badge>}
      {w.suspendedAt && <Badge variant="danger">정지됨</Badge>}
    </>
  );
}

export function PlatformConsole({ metrics, workspaces, auditLogs, homeOrgId }: PlatformConsoleProps) {
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
      toast.error(e instanceof Error ? e.message : '들어가지 못했습니다.');
      setBusy(null);
    }
  }

  async function createDemo(value: Segment, thenEnter: boolean) {
    setBusy(`demo-${value}`);
    try {
      const { workspace } = await adminRequest<{ workspace: { id: string; name: string } }>('/api/admin/workspaces', 'POST', { segment: value });
      toast.success(`'${workspace.name}'을(를) 만들었어요.`);
      if (thenEnter) await enterWorkspace(workspace.id, router);
      else router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '만들지 못했습니다.');
    } finally {
      setBusy(null);
    }
  }

  const total = metrics.workspaceCount || 1;

  return (
    <div className="space-y-6">
      <SegmentDashboardHeader title="운영자 콘솔" description="가입한 워크스페이스를 확인하고 제어해요. 데모 워크스페이스로 각 대시보드를 바로 테스트할 수 있어요." />

      <SummaryPanel title="서비스 현황" tooltip="운영자가 만든 데모 워크스페이스는 모든 가입·활동 수치에서 뺍니다. '활동'은 업로드·발주·매출·이벤트 입력·로그인 중 가장 최근 시각 기준이에요.">
        <SummaryMetric label="워크스페이스" value={`${metrics.workspaceCount}개`} detail={`사용자 ${metrics.userCount}명 · 데모 ${metrics.demoCount}개 별도`} />
        <SummaryMetric label="최근 7일 가입" value={`${metrics.signups7d}개`} detail={`최근 30일 ${metrics.signups30d}개`} emphasis={metrics.signups7d ? 'normal' : undefined} />
        <SummaryMetric label="최근 7일 활동" value={`${metrics.active7d}개`} detail={`전체의 ${Math.round((metrics.active7d / total) * 100)}%`} />
        <SummaryMetric label="정지된 워크스페이스" value={`${metrics.suspendedCount}개`} emphasis={metrics.suspendedCount ? 'danger' : undefined} />
      </SummaryPanel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <SectionPanel title="가입 추이" description="최근 30일 · 일별 신규 워크스페이스">
          <div className="px-3 pt-3 pb-2">
            <SignupChart data={metrics.signupsByDay} />
          </div>
        </SectionPanel>
        <SectionPanel title="관리 방식 분포" description="가입 때 고른 방식 기준">
          <ul className="space-y-3 px-5 py-4">
            {SEGMENT_ORDER.map((value) => {
              const count = metrics.bySegment[value];
              return (
                <li key={value}>
                  <div className="flex items-center justify-between text-sm">
                    <span>{SEGMENT_META[value].label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {count}개 · {Math.round((count / total) * 100)}%
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

      <SectionPanel title="데모 워크스페이스로 테스트" description="샘플 데이터가 채워진 워크스페이스를 만들어 실제 대시보드를 그대로 확인해요. 가입 통계에는 포함되지 않아요.">
        <div className="grid gap-3 px-5 py-4 md:grid-cols-3">
          {SEGMENT_ORDER.map((value) => (
            <div key={value} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div>
                <p className="text-sm font-semibold">{SEGMENT_META[value].label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{SEGMENT_META[value].audience}</p>
              </div>
              <div className="mt-auto flex gap-2">
                <Button size="sm" onClick={() => createDemo(value, true)} disabled={busy !== null}>
                  <Plus className="size-3.5" />
                  {busy === `demo-${value}` ? '만드는 중…' : '만들고 들어가기'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => createDemo(value, false)} disabled={busy !== null}>
                  만들기만
                </Button>
              </div>
            </div>
          ))}
        </div>
      </SectionPanel>

      <SectionPanel
        title="워크스페이스"
        description={`${filtered.length} / ${workspaces.length}개 · 최근 가입 순`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·이메일 검색" className="h-8 w-44 pl-8 text-sm" aria-label="워크스페이스 검색" />
            </div>
            <Select value={segment} onValueChange={(v) => setSegment(v as 'all' | Segment)}>
              <SelectTrigger className="h-8 w-36 text-sm" aria-label="관리 방식">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">모든 방식</SelectItem>
                {SEGMENT_ORDER.map((v) => (
                  <SelectItem key={v} value={v}>
                    {SEGMENT_META[v].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="h-8 w-28 text-sm" aria-label="상태">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 상태</SelectItem>
                <SelectItem value="active">사용 중</SelectItem>
                <SelectItem value="suspended">정지됨</SelectItem>
                <SelectItem value="demo">데모</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>워크스페이스</TableHead>
                <TableHead>관리 방식</TableHead>
                <TableHead>가입</TableHead>
                <TableHead className="text-right">사용자</TableHead>
                <TableHead>데이터</TableHead>
                <TableHead>마지막 활동</TableHead>
                <TableHead className="text-right">작업</TableHead>
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
                    <p className="truncate text-xs text-muted-foreground">{w.ownerEmail ?? '사용자 없음'}</p>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{SEGMENT_META[w.segment].label}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap" title={formatKstDateTime(w.createdAt)}>
                    {timeAgo(w.createdAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{w.userCount}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{dataSummary(w)}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{timeAgo(w.lastActivityAt)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => enter(w.id)} disabled={busy !== null} aria-label={`${w.name} 들어가기`}>
                      <LogIn className="size-3.5" />
                      {busy === w.id ? '여는 중…' : '들어가기'}
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/admin/workspaces/${w.id}`}>상세</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted-foreground">조건에 맞는 워크스페이스가 없어요.</p>}
        </div>
      </SectionPanel>

      <AuditLogPanel logs={auditLogs} />
    </div>
  );
}

export function AuditLogPanel({ logs, title = '최근 운영 기록' }: { logs: AuditLogRow[]; title?: string }) {
  return (
    <SectionPanel title={title} description="콘솔에서 한 조치는 모두 남아요">
      <ul className="divide-y divide-border">
        {logs.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted-foreground">아직 기록이 없어요.</li>}
        {logs.map((log) => {
          const detail = log.detail && typeof log.detail === 'object' ? (log.detail as Record<string, unknown>) : null;
          return (
            <li key={log.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-5 py-2.5 text-sm">
              <span className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground">{formatKstDateTime(log.createdAt)}</span>
              <span className="font-medium">{AUDIT_ACTION_LABEL[log.action] ?? log.action}</span>
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
