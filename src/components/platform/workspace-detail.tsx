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
import { SEGMENT_META, SEGMENT_ORDER, isSegment } from '@/lib/segments';
import { formatKstDateTime } from '@/lib/date';

interface WorkspaceDetailProps {
  summary: WorkspaceSummary;
  users: WorkspaceUserRow[];
  warehouses: WorkspaceWarehouseRow[];
  auditLogs: AuditLogRow[];
  homeOrgId: string;
}

export function WorkspaceDetail({ summary: w, users, warehouses, auditLogs, homeOrgId }: WorkspaceDetailProps) {
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
      toast.error(e instanceof Error ? e.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const patch = (body: unknown, success: string) => run(() => adminRequest(`/api/admin/workspaces/${w.id}`, 'PATCH', body), success);

  async function remove() {
    setBusy(true);
    try {
      await adminRequest(`/api/admin/workspaces/${w.id}`, 'DELETE', { confirmName });
      toast.success('워크스페이스를 삭제했어요.');
      router.push('/admin');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '삭제하지 못했습니다.');
      setBusy(false);
    }
  }

  async function resetPassword(user: WorkspaceUserRow) {
    if (!confirm(`${user.email}의 비밀번호를 임시 비밀번호로 바꿀까요? 기존 비밀번호는 더 이상 쓸 수 없어요.`)) return;
    setBusy(true);
    try {
      const { tempPassword: password } = await adminRequest<{ tempPassword: string }>(`/api/admin/users/${user.id}/reset-password`, 'POST');
      setTempPassword({ email: user.email, password });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '발급하지 못했습니다.');
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
            운영자 콘솔
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{w.name}</h1>
            <WorkspaceBadges w={w} homeOrgId={homeOrgId} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            가입 {formatKstDateTime(w.createdAt)} · {w.ownerEmail ?? '사용자 없음'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => enterWorkspace(w.id, router).catch((e) => toast.error(e.message))} disabled={busy}>
            <LogIn className="size-4" />
            들어가기
          </Button>
          {!protectedOrg &&
            (w.suspendedAt ? (
              <Button variant="outline" disabled={busy} onClick={() => patch({ suspended: false }, '정지를 해제했어요.')}>
                정지 해제
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => confirm('이 워크스페이스를 정지할까요? 소속 사용자는 로그인하지 못하고, 데이터는 그대로 남아요.') && patch({ suspended: true }, '워크스페이스를 정지했어요.')}
              >
                정지
              </Button>
            ))}
        </div>
      </div>

      <SummaryPanel title="현황">
        <SummaryMetric label="사용자" value={`${w.userCount}명`} detail={`마지막 로그인 ${timeAgo(w.lastLoginAt)}`} />
        <SummaryMetric label="마지막 활동" value={timeAgo(w.lastActivityAt)} detail="업로드·발주·매출·이벤트·로그인" />
        <SummaryMetric label="창고" value={`${w.warehouseCount}개`} detail={dataSummary(w)} />
        <SummaryMetric
          label="최근 30일 사용량"
          value={`업로드 ${w.uploads30d}회`}
          detail={`로그인 사용자 ${w.activeUsers30d}명 · 저장된 재고 행 ${w.storedRows.toLocaleString()}개${w.pendingInvites ? ` · 대기 초대 ${w.pendingInvites}건` : ''}`}
        />
        <SummaryMetric label="상태" value={w.suspendedAt ? '정지됨' : '사용 중'} emphasis={w.suspendedAt ? 'danger' : 'normal'} detail={w.suspendedAt ? `${formatKstDateTime(w.suspendedAt)} 정지` : undefined} />
      </SummaryPanel>

      <SectionPanel title="워크스페이스 정보">
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              patch({ name }, '이름을 바꿨어요.');
            }}
          >
            <Label htmlFor="ws-name">이름</Label>
            <div className="flex gap-2">
              <Input id="ws-name" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" variant="outline" disabled={busy || name.trim() === '' || name === w.name}>
                저장
              </Button>
            </div>
          </form>
          <div className="space-y-1.5">
            <Label htmlFor="ws-segment">기본 관리 방식</Label>
            <Select value={w.segment} onValueChange={(v) => isSegment(v) && patch({ segment: v }, '기본 관리 방식을 바꿨어요.')}>
              <SelectTrigger id="ws-segment" className="w-full" disabled={busy}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEGMENT_ORDER.map((v) => (
                  <SelectItem key={v} value={v}>
                    {SEGMENT_META[v].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">사용자가 처음 들어왔을 때 열리는 대시보드예요.</p>
          </div>
        </div>
      </SectionPanel>

      <SectionPanel title="사용자" description={`${users.length}명`}>
        {tempPassword && (
          <div role="status" className="border-b border-border bg-status-warning-bg px-5 py-3 text-sm">
            <p>
              <strong>{tempPassword.email}</strong>의 임시 비밀번호: <code className="rounded bg-background px-1.5 py-0.5 font-mono">{tempPassword.password}</code>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">이 화면을 벗어나면 다시 볼 수 없어요. 사용자에게 전달하고 로그인 후 바꾸도록 안내하세요.</p>
          </div>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>사용자</TableHead>
                <TableHead>권한</TableHead>
                <TableHead>가입</TableHead>
                <TableHead>마지막 로그인</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="text-right">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <p className="text-sm font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {u.role === 'ADMIN' ? '관리자' : u.role === 'VIEWER' ? '조회 전용' : '멤버'}
                    {u.isPlatformAdmin && (
                      <Badge variant="notice" className="ml-1.5">
                        운영자
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{formatKstDateTime(u.createdAt).slice(0, 10)}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{timeAgo(u.lastLoginAt)}</TableCell>
                  <TableCell>{u.isActive ? <Badge variant="normal">활성</Badge> : <Badge variant="stagnant">비활성</Badge>}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {!u.isPlatformAdmin && (
                      <>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => resetPassword(u)}>
                          <KeyRound className="size-3.5" />
                          임시 비밀번호
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => run(() => adminRequest(`/api/admin/users/${u.id}`, 'PATCH', { isActive: !u.isActive }), u.isActive ? '비활성화했어요.' : '다시 활성화했어요.')}
                        >
                          {u.isActive ? '비활성화' : '활성화'}
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {users.length === 0 && <p className="px-5 py-6 text-center text-sm text-muted-foreground">사용자가 없는 워크스페이스예요(데모). 들어가기로 확인하세요.</p>}
        </div>
      </SectionPanel>

      {warehouses.length > 0 && (
        <SectionPanel title="창고" description={`${warehouses.length}개 (보관 포함)`}>
          <ul className="divide-y divide-border">
            {warehouses.map((wh) => (
              <li key={wh.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className="w-8 rounded bg-muted px-1.5 py-0.5 text-center text-[11px] font-medium text-muted-foreground">{wh.code}</span>
                <span className="min-w-0 flex-1 truncate">{wh.name}</span>
                {wh.isArchived && <Badge variant="stagnant">보관</Badge>}
                <span className="text-xs text-muted-foreground">
                  SKU {wh.skuCount} · 마지막 업로드 {wh.lastSnapshotDate ?? '없음'}
                </span>
              </li>
            ))}
          </ul>
        </SectionPanel>
      )}

      <AuditLogPanel logs={auditLogs} title="이 워크스페이스의 운영 기록" />

      <section className="rounded-xl border border-status-danger/40" aria-label="워크스페이스 삭제">
        <div className="border-b border-status-danger/30 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-status-danger">워크스페이스 삭제</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {protectedOrg ? '운영자가 속한 워크스페이스는 삭제할 수 없어요.' : '사용자·재고·발주·매출 등 모든 데이터가 지워지며 되돌릴 수 없어요. 확인을 위해 워크스페이스 이름을 그대로 입력하세요.'}
          </p>
        </div>
        {!protectedOrg && (
          <div className="flex flex-wrap items-center gap-2 px-5 py-4">
            <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={w.name} className="max-w-xs" aria-label="삭제 확인용 워크스페이스 이름" />
            <Button variant="destructive" disabled={busy || confirmName !== w.name} onClick={remove}>
              영구 삭제
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
