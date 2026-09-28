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

export function SignupForm() {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState('');
  const [segment, setSegment] = useState<Segment>('DAILY_SYNC');
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
        body: JSON.stringify({ organizationName, segment, adminName, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? '가입에 실패했습니다. 잠시 후 다시 시도해주세요.');
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
            <Label htmlFor="organizationName">워크스페이스 이름</Label>
            <Input
              id="organizationName"
              required
              maxLength={50}
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="회사명 또는 매장명"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">재고를 어떻게 관리하고 있나요?</legend>
            <div className="grid gap-2" role="radiogroup">
              {SEGMENT_ORDER.map((value) => {
                const meta = SEGMENT_META[value];
                const selected = segment === value;
                return (
                  <label
                    key={value}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                      selected ? 'border-brand-accent bg-brand-accent/10' : 'hover:bg-muted/60',
                    )}
                  >
                    <input
                      type="radio"
                      name="segment"
                      value={value}
                      checked={selected}
                      onChange={() => setSegment(value)}
                      className="mt-1 accent-[var(--brand-accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{meta.label}</span>
                      <span className="block text-xs text-muted-foreground">{meta.audience}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">나중에 사이드바에서 언제든 다른 대시보드로 바꿔 볼 수 있어요.</p>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="adminName">이름</Label>
            <Input id="adminName" required maxLength={50} autoComplete="name" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">이메일</Label>
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">비밀번호</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8자 이상"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '워크스페이스 만드는 중...' : '워크스페이스 만들기'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
