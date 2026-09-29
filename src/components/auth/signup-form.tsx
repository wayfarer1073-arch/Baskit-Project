'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { SEGMENT_META, SEGMENT_ORDER, type Segment } from '@/lib/segments';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n/i18n-provider';
import { TermsConsent } from '@/components/auth/terms-consent';

export function SignupForm() {
  const { m } = useI18n();
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState('');
  const [segment, setSegment] = useState<Segment>('DAILY_SYNC');
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationName, segment, adminName, email, password, acceptTerms }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? m.auth.signupFailed);
        return;
      }
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        router.push('/login');
        return;
      }
      router.push(SEGMENT_META[segment].dashboardHref);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="organizationName">{m.auth.workspaceName}</Label>
            <Input
              id="organizationName"
              required
              maxLength={50}
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder={m.auth.workspaceNamePlaceholder}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{m.auth.howDoYouManage}</legend>
            <div className="grid gap-2" role="radiogroup">
              {SEGMENT_ORDER.map((value) => {
                const selected = segment === value;
                return (
                  <label
                    key={value}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                      selected ? 'border-brand-accent bg-brand-accent/10' : 'hover:bg-muted/60',
                    )}
                  >
                    <input type="radio" name="segment" value={value} checked={selected} onChange={() => setSegment(value)} className="mt-1 accent-[var(--brand-accent)]" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{m.segments[value].label}</span>
                      <span className="block text-xs text-muted-foreground">{m.segments[value].audience}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{m.auth.switchLater}</p>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="adminName">{m.auth.yourName}</Label>
            <Input id="adminName" required maxLength={50} autoComplete="name" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">{m.auth.email}</Label>
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{m.auth.password}</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={m.auth.passwordPlaceholder}
            />
          </div>
          <TermsConsent checked={acceptTerms} onChange={setAcceptTerms} />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? m.auth.creating : m.auth.createWorkspace}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
