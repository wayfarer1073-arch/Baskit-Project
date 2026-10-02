import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { BLOCKED_LOGIN_PATH, getTenant } from '@/server/tenant';
import { getOrganization } from '@/server/repositories/organization-repository';
import { listLatestPostPerTag } from '@/server/repositories/post-repository';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { ActingAsBanner } from '@/components/platform/acting-as-banner';
import { getMessages } from '@/server/i18n';
import { getSegmentContext } from '@/server/segments';
import { getAccountStatus } from '@/server/repositories/account-repository';
import { VerifyEmailBanner } from '@/components/auth/verify-email-banner';
import { mustVerifyEmail } from '@/server/email-verification';
import { Suspense } from 'react';
import Link from 'next/link';
import { CALENDAR_HREF } from '@/lib/segments';
import { NavigationOverlay } from '@/components/layout/navigation-overlay';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const tenant = await getTenant();
  if (!session?.user) redirect('/login');
  if (!tenant) redirect(BLOCKED_LOGIN_PATH);
  const m = await getMessages();
  const roleLabel = tenant.actingAs ? m.nav.roles.operator : tenant.role === 'ADMIN' ? m.nav.roles.admin : tenant.role === 'VIEWER' ? m.nav.roles.viewer : m.nav.roles.member;
  const [recentPosts, organization, account] = await Promise.all([listLatestPostPerTag(tenant.orgId), getOrganization(tenant.orgId), getAccountStatus(tenant.userId)]);
  // 이메일 인증 전에는 앱 대신 인증 안내 화면으로 보낸다(운영자가 워크스페이스에 들어간 경우·운영자 계정은 제외).
  if (!tenant.actingAs && !tenant.isPlatformAdmin && account && mustVerifyEmail(account)) redirect('/verify-required');
  const { enabled: enabledSegments, active: defaultSegment } = await getSegmentContext(tenant.orgId);

  return (
    <div className="flex min-h-screen">
      <AppSidebar
        userName={session.user.name ?? ''}
        userRole={roleLabel}
        workspaceName={organization.name}
        defaultSegment={defaultSegment}
        enabledSegments={enabledSegments}
        recentPosts={recentPosts}
        isPlatformAdmin={tenant.isPlatformAdmin}
        className="hidden sm:flex"
      />
      <div className="relative flex min-h-screen min-w-0 flex-1 flex-col">
        <Suspense fallback={null}>
          <NavigationOverlay />
        </Suspense>
        {tenant.actingAs && <ActingAsBanner workspaceName={organization.name} />}
        {!tenant.actingAs && account && !account.emailVerifiedAt && <VerifyEmailBanner email={account.email} />}
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 sm:hidden">
          <MobileNav
            userName={session.user.name ?? ''}
            userRole={roleLabel}
            workspaceName={organization.name}
            defaultSegment={defaultSegment}
            enabledSegments={enabledSegments}
            isPlatformAdmin={tenant.isPlatformAdmin}
            recentPosts={recentPosts}
          />
          <Link href={CALENDAR_HREF} className="inline-flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.png" alt="" className="size-8 shrink-0" />
            <span className="text-sm font-semibold tracking-tight text-foreground">Limenote</span>
          </Link>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1840px] flex-1 px-4 py-7 outline-none sm:px-6 lg:px-8 lg:py-9">
          {children}
        </main>
      </div>
    </div>
  );
}
