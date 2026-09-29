import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { getSkuDetail } from '@/server/services/inventory-analysis-service';
import { getSettings } from '@/server/repositories/settings-repository';
import { setSkuB2B, setSkuHiddenFromDashboard, setSkuManualThresholds } from '@/server/repositories/inventory-repository';
import { todayKstDateString } from '@/lib/date';

export async function GET(request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { skuId } = await params;
  const url = new URL(request.url);
  const asOfDate = url.searchParams.get('asOf') ?? todayKstDateString();

  const settings = await getSettings(tenant.orgId);
  const detail = await getSkuDetail(tenant.orgId, skuId, asOfDate, settings);
  if (!detail) return NextResponse.json({ error: 'SKU를 찾을 수 없습니다.' }, { status: 404 });

  return NextResponse.json(detail);
}

// manualDangerQty/manualWarningQty는 항상 함께 보내야 한다 — 한쪽만 보내면 다른 쪽은 null(자동계산)로
// 간주되어 기존 설정을 덮어쓴다. UI는 이 두 필드를 하나의 폼으로 묶어 항상 같이 전송한다.
const patchSchema = z
  .object({
    isHiddenFromDashboard: z.boolean().optional(),
    isB2B: z.boolean().optional(),
    manualDangerQty: z.number().int().min(0).nullable().optional(),
    manualWarningQty: z.number().int().min(0).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: '변경할 값이 없습니다.' });

export async function PATCH(request: Request, { params }: { params: Promise<{ skuId: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 변경할 수 있습니다.' }, { status: 403 });

  const { skuId } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });

  try {
    if (parsed.data.isHiddenFromDashboard !== undefined) {
      const sku = await setSkuHiddenFromDashboard(tenant.orgId, skuId, parsed.data.isHiddenFromDashboard);
      return NextResponse.json({ skuId: sku.id, isHiddenFromDashboard: sku.isHiddenFromDashboard });
    }
    if (parsed.data.isB2B !== undefined) {
      const sku = await setSkuB2B(tenant.orgId, skuId, parsed.data.isB2B);
      return NextResponse.json({ skuId: sku.id, isB2B: sku.isB2B });
    }
    const sku = await setSkuManualThresholds(tenant.orgId, skuId, {
      dangerQty: parsed.data.manualDangerQty ?? null,
      warningQty: parsed.data.manualWarningQty ?? null,
    });
    return NextResponse.json({ skuId: sku.id, manualDangerQty: sku.manualDangerQty, manualWarningQty: sku.manualWarningQty });
  } catch {
    return NextResponse.json({ error: 'SKU를 찾을 수 없습니다.' }, { status: 404 });
  }
}
