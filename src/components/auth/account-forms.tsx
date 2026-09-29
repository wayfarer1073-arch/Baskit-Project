'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useI18n } from '@/components/i18n/i18n-provider';
import { TermsConsent } from '@/components/auth/terms-consent';

async function post(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, error: data.error };
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}

export function BackToLogin() {
  const { m } = useI18n();
  return (
    <p className="text-center text-sm text-sidebar-muted-foreground">
      <Link href="/login" className="font-medium text-sidebar-foreground underline-offset-4 hover:underline">
        {m.account.backToLogin}
      </Link>
    </p>
  );
}

export function ForgotPasswordForm() {
  const { m } = useI18n();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    setError(null);
    const result = await post('/api/account/password-reset', { email });
    if (!result.ok) {
      setError(result.error ?? m.account.failed);
      setState('idle');
      return;
    }
    setState('sent');
  }

  return (
    <Card>
      <CardContent>
        {state === 'sent' ? (
          <p role="status" className="text-sm">
            {m.account.forgotSent}
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">{m.auth.email}</Label>
              <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
            </div>
            {error && <ErrorText>{error}</ErrorText>}
            <Button type="submit" className="w-full" disabled={state === 'sending'}>
              {state === 'sending' ? m.account.sending : m.account.sendLink}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function PasswordPair({ password, confirm, onPassword, onConfirm }: { password: string; confirm: string; onPassword: (v: string) => void; onConfirm: (v: string) => void }) {
  const { m } = useI18n();
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="new-password">{m.account.newPassword}</Label>
        <Input
          id="new-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder={m.auth.passwordPlaceholder}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">{m.account.confirmPassword}</Label>
        <Input id="confirm-password" type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => onConfirm(e.target.value)} />
      </div>
    </>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const { m } = useI18n();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError(m.account.passwordMismatch);
    setBusy(true);
    setError(null);
    const result = await post('/api/account/password-reset/confirm', { token, password });
    setBusy(false);
    if (!result.ok) return setError(result.error ?? m.account.failed);
    setDone(true);
  }

  return (
    <Card>
      <CardContent>
        {done ? (
          <div className="space-y-4">
            <p role="status" className="text-sm">
              {m.account.resetDone}
            </p>
            <Button asChild className="w-full">
              <Link href="/login">{m.auth.loginButton}</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <PasswordPair password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
            {error && <ErrorText>{error}</ErrorText>}
            <Button type="submit" className="w-full" disabled={busy}>
              {m.account.resetButton}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const { m } = useI18n();
  const router = useRouter();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError(m.account.passwordMismatch);
    setBusy(true);
    setError(null);
    const result = await post('/api/invitations/accept', { token, name, password, acceptTerms });
    if (!result.ok) {
      setBusy(false);
      return setError(result.error ?? m.account.failed);
    }
    const login = await signIn('credentials', { email, password, redirect: false });
    router.push(login?.error ? '/login' : '/');
    router.refresh();
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">{m.auth.email}</Label>
            <Input id="invite-email" value={email} disabled readOnly />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">{m.auth.yourName}</Label>
            <Input id="invite-name" required maxLength={50} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <PasswordPair password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
          <TermsConsent checked={acceptTerms} onChange={setAcceptTerms} />
          {error && <ErrorText>{error}</ErrorText>}
          <Button type="submit" className="w-full" disabled={busy}>
            {m.account.inviteJoin}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
