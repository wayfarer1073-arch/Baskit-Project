import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { getTenant } from '@/server/tenant';
import { getOrganization } from '@/server/repositories/organization-repository';
import { SEGMENT_COOKIE, isSegment } from '@/lib/segments';
import { listLatestPostPerTag } from '@/server/repositories/post-repository';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const tenant = await getTenant();
  if (!session?.user || !tenant) redirect('/login');
  const roleLabel = session.user.role === 'ADMIN' ? '관리자' : '멤버';
  const [recentPosts, organization] = await Promise.all([listLatestPostPerTag(tenant.orgId), getOrganization(tenant.orgId)]);
  const remembered = (await cookies()).get(SEGMENT_COOKIE)?.value;
  const defaultSegment = isSegment(remembered) ? remembered : organization.segment;

  return (
    <div className="flex min-h-screen">
      <AppSidebar
        userName={session.user.name ?? ''}
        userRole={roleLabel}
        workspaceName={organization.name}
        defaultSegment={defaultSegment}
        recentPosts={recentPosts}
        className="hidden sm:flex"
      />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 sm:hidden">
          <MobileNav userName={session.user.name ?? ''} userRole={roleLabel} defaultSegment={defaultSegment} />
          <span className="inline-flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.png" alt="" className="size-8 shrink-0" />
            <span className="text-sm font-semibold tracking-tight text-foreground">Limenote</span>
          </span>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1840px] flex-1 px-4 py-7 outline-none sm:px-6 lg:px-8 lg:py-9">
          {children}
        </main>
      </div>
    </div>
  );
}
