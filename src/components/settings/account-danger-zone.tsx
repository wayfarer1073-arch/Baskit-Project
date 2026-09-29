'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

async function remove(url: string, body: unknown) {
  const res = await fetch(url, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error);
}

/** 설정 공통 탭 맨 아래 — 내 계정 정보와 탈퇴, (관리자) 워크스페이스 삭제. */
export function AccountDangerZone({ email, verified, isAdmin, workspaceName }: { email: string; verified: boolean; isAdmin: boolean; workspaceName: string }) {
  const { m } = useI18n();
  const t = m.danger;
  const [mode, setMode] = useState<'withdraw' | 'workspace' | null>(null);
  const [password, setPassword] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);

  function open(next: 'withdraw' | 'workspace') {
    setPassword('');
    setConfirmName('');
    setMode(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'workspace') await remove('/api/workspace', { confirmName, password });
      else await remove('/api/account', { password });
      await signOut({ callbackUrl: '/login' });
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t.failed);
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.accountTitle}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          {format(t.accountDescription, { email })}
          <Badge variant={verified ? 'secondary' : 'warning'}>{verified ? t.verified : t.unverified}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-lg text-xs text-muted-foreground">{t.withdrawBody}</p>
          <Button variant="outline" className="text-destructive" onClick={() => open('withdraw')}>
            {t.withdraw}
          </Button>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <div className="max-w-lg">
              <p className="text-sm font-medium text-destructive">{t.workspaceTitle}</p>
              <p className="text-xs text-muted-foreground">{t.workspaceDescription}</p>
            </div>
            <Button variant="destructive" onClick={() => open('workspace')}>
              {t.workspaceDelete}
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={mode !== null} onOpenChange={(v) => !v && !busy && setMode(null)}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{mode === 'workspace' ? t.workspaceTitle : t.withdrawTitle}</DialogTitle>
              <DialogDescription>{mode === 'workspace' ? t.workspaceDescription : t.withdrawBody}</DialogDescription>
            </DialogHeader>
            {mode === 'workspace' && (
              <div className="space-y-1.5">
                <Label htmlFor="confirm-workspace-name">{format(t.workspaceConfirm, { name: workspaceName })}</Label>
                <Input id="confirm-workspace-name" required autoComplete="off" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={workspaceName} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">{t.password}</Label>
              <Input id="confirm-password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setMode(null)} disabled={busy}>
                {t.cancel}
              </Button>
              <Button type="submit" variant="destructive" disabled={busy || !password || (mode === 'workspace' && confirmName.trim() !== workspaceName)}>
                {t.confirm}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
