import { NextResponse } from 'next/server';
import { forbidViewer, getTenant } from '@/server/tenant';
import { previewUpload } from '@/server/services/upload-service';
import { parseLayoutField } from '@/server/validation/import-layout';
import { MAX_UPLOAD_BYTES } from '@/lib/upload-limits';
import { getWarehouseInOrg } from '@/server/repositories/warehouse-repository';

/** 저장하지 않고 파일 양식(시트·헤더·열 추천·샘플)을 확인한다. */
export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '파일을 선택하세요.' }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: `파일이 너무 큽니다 (최대 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB).` }, { status: 413 });
  const layout = parseLayoutField(formData.get('layout'));
  if (layout === null) return NextResponse.json({ error: '양식 정보가 올바르지 않습니다.' }, { status: 400 });

  const warehouseIdRaw = formData.get('warehouseId');
  const warehouseId = typeof warehouseIdRaw === 'string' && (await getWarehouseInOrg(tenant.orgId, warehouseIdRaw)) ? warehouseIdRaw : undefined;
  const dateRaw = formData.get('date');
  const date = typeof dateRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : undefined;
  const preview = await previewUpload(tenant.orgId, Buffer.from(await file.arrayBuffer()), layout, warehouseId, date);
  if ('error' in preview) return NextResponse.json(preview, { status: 422 });
  return NextResponse.json(preview);
}
