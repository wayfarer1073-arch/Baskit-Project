import Link from 'next/link';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const blocked = (await searchParams).reason === 'blocked';
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.png" alt="" className="size-14" />
          <p className="text-2xl font-semibold tracking-tight text-sidebar-foreground">Limenote</p>
          <p className="text-sm text-sidebar-muted-foreground">계정으로 로그인하세요</p>
        </div>
        {blocked && (
          <p role="alert" className="rounded-lg border border-status-warning/40 bg-status-warning-bg px-4 py-3 text-sm text-status-warning">
            계정이 비활성화되었거나 워크스페이스 이용이 정지되었어요. 워크스페이스 관리자나 서비스 운영자에게 문의해 주세요.
          </p>
        )}
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
        <p className="text-center text-sm text-sidebar-muted-foreground">
          처음이신가요?{' '}
          <Link href="/signup" className="font-medium text-sidebar-foreground underline-offset-4 hover:underline">
            워크스페이스 만들기
          </Link>
        </p>
      </div>
    </div>
  );
}
