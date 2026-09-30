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
        {/* 모바일 머리글 — 데스크톱 사이드바와 같은 매트 블랙 바탕. */}
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-sidebar-border bg-sidebar px-4 text-sidebar-foreground sm:hidden">
          <MobileNav
            userName={session.user.name ?? ''}
            userRole={roleLabel}
            defaultSegment={defaultSegment}
            enabledSegments={enabledSegments}
            isPlatformAdmin={tenant.isPlatformAdmin}
            recentPosts={recentPosts}
            triggerClassName="text-sidebar-foreground hover:bg-sidebar-hover-bg hover:text-sidebar-foreground"
          />
          <Link href={CALENDAR_HREF} className="inline-flex min-w-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.png" alt="" className="size-8 shrink-0" />
            <span className="min-w-0 leading-tight">
              <span className="block text-sm font-semibold tracking-tight">Limenote</span>
              <span className="block truncate text-[11px] text-sidebar-muted-foreground">{organization.name}</span>
            </span>
          </Link>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1840px] flex-1 px-4 py-7 outline-none sm:px-6 lg:px-8 lg:py-9">
          {children}
        </main>
      </div>
    </div>
  );
}
