'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SignOutButton } from '@/components/layout/sign-out-button';
import { useI18n } from '@/components/i18n/i18n-provider';

export function VerifyRequiredActions() {
  const { m } = useI18n();
  const [busy, setBusy] = useState(false);

  async function resend() {
    setBusy(true);
    try {
      const res = await fetch('/api/account/verify-email/resend', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      if (data.alreadyVerified) {
        window.location.href = '/';
        return;
      }
      toast.success(m.account.resent);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : m.account.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button className="w-full bg-brand-accent font-semibold text-black hover:bg-brand-accent/90" onClick={resend} disabled={busy}>
        {m.account.resendVerify}
      </Button>
      <Button asChild variant="outline" className="w-full">
        <Link href="/">{m.account.verifyRequiredDone}</Link>
      </Button>
      <p className="text-center text-xs text-sidebar-muted-foreground">{m.account.verifyRequiredHint}</p>
      <div className="flex justify-center">
        <SignOutButton className="text-sidebar-muted-foreground hover:bg-sidebar-hover-bg hover:text-sidebar-foreground" />
      </div>
    </div>
  );
}
