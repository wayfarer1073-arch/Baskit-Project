'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';
import { Paged } from '@/components/ui/paged';

type InviteRole = 'VIEWER' | 'MEMBER' | 'ADMIN';
interface PendingInvite {
  id: string;
  email: string;
  role: InviteRole;
  expiresAt: string;
  expired: boolean;
}

/** 관리자가 이메일로 팀원을 초대하고, 대기 중인 초대를 취소한다. */
export function TeamInvitations() {
  const { m } = useI18n();
  const t = m.invites;
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('MEMBER');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [lastLink, setLastLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/invitations');
    if (res.ok) setPending((await res.json()).invitations ?? []);
  }, []);

  useEffect(() => {
    // 마운트할 때 한 번 목록을 불러온다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/invitations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success(t.sent);
      setLastLink(data.link ?? null);
      setEmail('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t.failed);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/invitations/${id}`, { method: 'DELETE' });
    if (!res.ok) return toast.error(t.failed);
    toast.success(t.revoked);
    await load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={invite} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="invite-email-input" className="text-xs">
              {t.email}
            </Label>
            <Input id="invite-email-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-role" className="text-xs">
              {t.role}
            </Label>
            <Select value={role} onValueChange={(v) => setRole(v as InviteRole)}>
              <SelectTrigger id="invite-role" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['VIEWER', 'MEMBER', 'ADMIN'] as const).map((r) => (
                  <SelectItem key={r} value={r}>
                    {t.roles[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={busy || !email}>
            {t.send}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">{t.roleHint}</p>

        {lastLink && (
          <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">{t.linkReady}</p>
            <div className="flex gap-2">
              <Input readOnly value={lastLink} className="h-8 text-xs" aria-label={t.copy} onFocus={(e) => e.currentTarget.select()} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(lastLink).catch(() => undefined);
                  toast.success(t.copied);
                }}
              >
                <Copy className="size-3.5" /> {t.copy}
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2 border-t pt-3">
          <h3 className="text-sm font-medium">{t.pending}</h3>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.none}</p>
          ) : (
            <Paged items={pending} pagerClassName="mt-2">
              {(pageItems) => (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {pageItems.map((inv) => (
                    <li key={inv.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{inv.email}</span>
                      <Badge variant="outline">{t.roles[inv.role]}</Badge>
                      <span className="text-xs text-muted-foreground">{inv.expired ? t.expired : format(t.expires, { date: inv.expiresAt.slice(0, 10) })}</span>
                      <Button size="icon" variant="ghost" className="ml-auto size-7" aria-label={`${t.revoke} ${inv.email}`} onClick={() => revoke(inv.id)}>
                        <X className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Paged>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
