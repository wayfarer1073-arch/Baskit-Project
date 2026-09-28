import { notFound } from 'next/navigation';
import { getPlatformAdmin } from '@/server/tenant';
import { computePlatformMetrics, listAuditLogs, listWorkspaceSummaries } from '@/server/repositories/platform-repository';
import { PlatformConsole } from '@/components/platform/platform-console';

export default async function AdminConsolePage() {
  const admin = await getPlatformAdmin();
  // 운영자가 아니면 콘솔이 있다는 사실도 드러내지 않는다.
  if (!admin) notFound();
  const [workspaces, auditLogs] = await Promise.all([listWorkspaceSummaries(), listAuditLogs(20)]);
  return <PlatformConsole metrics={computePlatformMetrics(workspaces)} workspaces={workspaces} auditLogs={auditLogs} homeOrgId={admin.homeOrgId} />;
}
