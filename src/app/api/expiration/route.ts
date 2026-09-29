import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { parseExpirationWorkbook } from '@/domain/excel/expiration-parser';
import { getWarehouseInOrg } from '@/server/repositories/warehouse-repository';
import { listExpirationLots, applyExpirationLotRows, setExpirationRiskDaysBulk } from '@/server/repositories/expiration-repository';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function GET() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const entries = await listExpirationLots(tenant.orgId);
  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 업로드할 수 있습니다.' }, { status: 403 });

  const formData = await request.formData();
  const warehouseId = formData.get('warehouseId');
  const file = formData.get('file');

  if (typeof warehouseId !== 'string' || !(file instanceof File)) {
    return NextResponse.json({ error: '필수 항목이 누락되었습니다 (창고, 파일).' }, { status: 400 });
  }
  if (!(await getWarehouseInOrg(tenant.orgId, warehouseId))) return NextResponse.json({ error: '창고를 찾을 수 없습니다.' }, { status: 404 });
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: `파일이 너무 큽니다 (최대 ${MAX_FILE_BYTES / 1024 / 1024}MB).` }, { status: 413 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const parseResult = parseExpirationWorkbook(Buffer.from(arrayBuffer));
  const errors = parseResult.issues.filter((i) => i.level === 'ERROR');
  if (errors.length > 0) {
    return NextResponse.json({ status: 'ERROR', issues: parseResult.issues }, { status: 422 });
  }

  const applyResult = await applyExpirationLotRows(warehouseId, parseResult.rows);
  return NextResponse.json({
    status: 'SUCCESS',
    updatedCount: applyResult.updatedCount,
    unmatchedProductCodes: applyResult.unmatchedProductCodes,
    issues: parseResult.issues,
  });
}

const bulkPatchSchema = z.object({ skuIds: z.array(z.string()).min(1), expirationRiskDays: z.number().int().min(0) });

/** 체크박스로 선택한 여러 SKU의 소비기한 위험 판정 일수를 한 번에 같은 값으로 설정한다. */
export async function PATCH(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 변경할 수 있습니다.' }, { status: 403 });

  const body = await request.json();
  const parsed = bulkPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });

  const updatedCount = await setExpirationRiskDaysBulk(tenant.orgId, parsed.data.skuIds, parsed.data.expirationRiskDays);
  return NextResponse.json({ updatedCount });
}
