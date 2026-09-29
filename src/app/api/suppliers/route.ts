import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { prisma } from '@/lib/prisma';

/** 거래처 목록(일일 재고 연동 품목의 거래처 선택용). */
export async function GET() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const suppliers = await prisma.supplier.findMany({ where: { organizationId: tenant.orgId }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  return NextResponse.json({ suppliers });
}
