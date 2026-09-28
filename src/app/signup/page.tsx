import Link from 'next/link';
import { SignupForm } from '@/components/auth/signup-form';

export default function SignupPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-sidebar px-4 py-10">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.png" alt="" className="size-14" />
          <p className="text-2xl font-semibold tracking-tight text-sidebar-foreground">Limenote 시작하기</p>
          <p className="text-sm text-sidebar-muted-foreground">워크스페이스를 만들면 바로 첫 관리자로 로그인돼요</p>
        </div>
        <SignupForm />
        <p className="text-center text-sm text-sidebar-muted-foreground">
          이미 계정이 있나요?{' '}
          <Link href="/login" className="font-medium text-sidebar-foreground underline-offset-4 hover:underline">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
