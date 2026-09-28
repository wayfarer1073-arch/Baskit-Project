import { notFound } from 'next/navigation';
import { getPlatformAdmin } from '@/server/tenant';
import { getWorkspaceDetail, listAuditLogs } from '@/server/repositories/platform-repository';
import { WorkspaceDetail } from '@/components/platform/workspace-detail';

export default async function AdminWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getPlatformAdmin();
  if (!admin) notFound();
  const { id } = await params;
  const [detail, auditLogs] = await Promise.all([getWorkspaceDetail(id), listAuditLogs(20, id)]);
  if (!detail) notFound();
  return <WorkspaceDetail summary={detail.summary} users={detail.users} warehouses={detail.warehouses} auditLogs={auditLogs} homeOrgId={admin.homeOrgId} />;
}
