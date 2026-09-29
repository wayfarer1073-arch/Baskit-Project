import { LanguageSwitcher } from '@/components/i18n/language-switcher';

/** 로그인 밖 화면(비밀번호 재설정·초대·인증)의 공통 틀 — 로그인 화면과 같은 모양. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-sidebar px-4 py-10">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.png" alt="" className="size-14" />
          <h1 className="text-2xl font-semibold tracking-tight text-sidebar-foreground">{title}</h1>
          {subtitle && <p className="text-sm text-sidebar-muted-foreground">{subtitle}</p>}
        </div>
        {children}
        <div className="flex justify-center">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}
