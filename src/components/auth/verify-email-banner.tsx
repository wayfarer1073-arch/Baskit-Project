'use client';

import { useState } from 'react';
import { MailWarning } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

/** 이메일 인증을 마치지 않은 사용자에게 보이는 안내. 이용은 막지 않는다. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const { m } = useI18n();
  const [busy, setBusy] = useState(false);

  async function resend() {
    setBusy(true);
    try {
      const res = await fetch('/api/account/verify-email/resend', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success(m.account.resent);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : m.account.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-status-warning/30 bg-status-warning-bg px-4 py-2 text-center text-sm text-status-warning"
    >
      <MailWarning className="size-4 shrink-0" aria-hidden="true" />
      <span>{format(m.account.verifyBanner, { email })}</span>
      <button
        type="button"
        onClick={resend}
        disabled={busy}
        className="rounded-md border border-status-warning/40 px-2.5 py-0.5 text-xs font-semibold transition-colors hover:bg-status-warning/10 disabled:opacity-60"
      >
        {m.account.resendVerify}
      </button>
    </div>
  );
}
