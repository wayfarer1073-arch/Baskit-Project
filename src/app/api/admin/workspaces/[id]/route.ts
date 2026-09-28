import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPlatformAdmin } from '@/server/tenant';
import { prisma } from '@/lib/prisma';
import { deleteWorkspace, recordAudit, setWorkspaceSuspended, updateWorkspace } from '@/server/repositories/platform-repository';

const patchSchema = z
  .object({
    suspended: z.boolean().optional(),
    segment: z.enum(['DAILY_SYNC', 'PERIODIC_COUNT', 'ORDER_CYCLE']).optional(),
    name: z.string().trim().min(1).max(50).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: '변경할 값이 없습니다.' });

async function loadTarget(id: string) {
  return prisma.organization.findUnique({ where: { id }, select: { id: true, name: true, users: { where: { isPlatformAdmin: true }, select: { id: true } } } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getPlatformAdmin();
  if (!admin) return NextResponse.json({ error: '운영자만 사용할 수 있습니다.' }, { status: 403 });

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  const target = await loadTarget(id);
  if (!target) return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다.' }, { status: 404 });

  if (parsed.data.suspended !== undefined) {
    if (parsed.data.suspended && target.users.length > 0) {
      return NextResponse.json({ error: '운영자가 속한 워크스페이스는 정지할 수 없습니다.' }, { status: 400 });
    }
    await setWorkspaceSuspended(id, parsed.data.suspended);
    await recordAudit(admin.userId, parsed.data.suspended ? 'workspace.suspend' : 'workspace.unsuspend', target);
  }
  if (parsed.data.segment || parsed.data.name) {
    await updateWorkspace(id, { segment: parsed.data.segment, name: parsed.data.name });
    await recordAudit(admin.userId, 'workspace.update', target, { segment: parsed.data.segment ?? null, name: parsed.data.name ?? null });
  }
  return NextResponse.json({ ok: true });
}

const deleteSchema = z.object({ confirmName: z.string() });

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getPlatformAdmin();
  if (!admin) return NextResponse.json({ error: '운영자만 사용할 수 있습니다.' }, { status: 403 });

  const { id } = await params;
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  const target = await loadTarget(id);
  if (!target) return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다.' }, { status: 404 });
  if (!parsed.success || parsed.data.confirmName !== target.name) {
    return NextResponse.json({ error: '확인용 워크스페이스 이름이 일치하지 않습니다.' }, { status: 400 });
  }
  if (target.users.length > 0 || id === admin.homeOrgId) {
    return NextResponse.json({ error: '운영자가 속한 워크스페이스는 삭제할 수 없습니다.' }, { status: 400 });
  }

  await deleteWorkspace(id);
  await recordAudit(admin.userId, 'workspace.delete', target);
  return NextResponse.json({ ok: true });
}
