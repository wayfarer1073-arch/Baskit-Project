import { after, NextResponse } from 'next/server';
import { forbidViewer, getTenant } from '@/server/tenant';
import { getWarehouseInOrg } from '@/server/repositories/warehouse-repository';
import { bufferToAoa, SpreadsheetRejectedError } from '@/domain/excel/aoa-reader';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_DATA_ROWS } from '@/lib/upload-limits';
import { PeriodFileError, previewPeriodUpload, type PeriodFileInput, type PeriodUploadInput } from '@/server/services/period-upload-service';
import { createUploadJob, runPeriodUploadJob } from '@/server/services/upload-job-service';

async function readFile(value: FormDataEntryValue | null): Promise<PeriodFileInput | null | string> {
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > MAX_UPLOAD_BYTES) return `${value.name}: 파일이 너무 큽니다(최대 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB).`;
  try {
    const aoa = bufferToAoa(Buffer.from(await value.arrayBuffer()));
    if (aoa.length - 1 > MAX_UPLOAD_DATA_ROWS) return `${value.name}: 줄이 너무 많습니다(최대 ${MAX_UPLOAD_DATA_ROWS.toLocaleString()}줄).`;
    return { aoa, fileName: value.name };
  } catch (e) {
    return e instanceof SpreadsheetRejectedError ? e.message : `${value.name}: 파일을 읽을 수 없습니다. 엑셀(.xlsx, .xls) 또는 CSV로 올려 주세요.`;
  }
}

/**
 * 기간 일괄 업로드 — 일자별 재고 현황표(stock)와 일자별 입고 현황표(inbound)를 받는다(둘 중 하나 이상).
 * action=preview는 무엇을 올릴지 요약만 돌려주고, action=run은 작업을 접수해 뒤에서 처리한다(/api/upload/jobs/[id]로 확인).
 * overwrite=true(이미 올린 날짜도 바꾸기)는 관리자만.
 */
export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  const warehouseId = form.get('warehouseId');
  if (typeof warehouseId !== 'string' || !(await getWarehouseInOrg(tenant.orgId, warehouseId, { segment: 'DAILY_SYNC' }))) {
    return NextResponse.json({ error: '일일 재고 창고를 찾을 수 없습니다.' }, { status: 404 });
  }
  const overwrite = form.get('overwrite') === 'true';
  if (overwrite && !tenant.isAdmin) return NextResponse.json({ error: '이미 올린 날짜를 바꾸는 것은 관리자만 할 수 있습니다.' }, { status: 403 });

  const stock = await readFile(form.get('stock'));
  const inbound = await readFile(form.get('inbound'));
  for (const f of [stock, inbound]) if (typeof f === 'string') return NextResponse.json({ error: f }, { status: 400 });
  if (!stock && !inbound) return NextResponse.json({ error: '재고 현황표나 입고 현황표 중 하나는 올려 주세요.' }, { status: 400 });

  const input: PeriodUploadInput = {
    orgId: tenant.orgId,
    warehouseId,
    userId: tenant.userId,
    stock: stock as PeriodFileInput | null,
    inbound: inbound as PeriodFileInput | null,
    overwrite,
  };
  let preview;
  try {
    preview = await previewPeriodUpload(input);
  } catch (e) {
    if (e instanceof PeriodFileError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  if (form.get('action') !== 'run') return NextResponse.json(preview);

  if (preview.uploadDays === 0 && preview.inboundEntries - (overwrite ? 0 : preview.inboundExisting) <= 0) {
    return NextResponse.json({ error: '새로 올릴 날짜나 입고 기록이 없습니다.' }, { status: 400 });
  }
  const first = preview.from ?? preview.inboundFrom!;
  const job = await createUploadJob({
    orgId: tenant.orgId,
    userId: tenant.userId,
    warehouseId,
    snapshotDate: new Date(`${first}T00:00:00.000Z`),
    fileName: preview.stockFileName ?? preview.inboundFileName ?? '',
    fileSize: 0,
  });
  after(() => runPeriodUploadJob(job.id, input));
  return NextResponse.json({ status: 'QUEUED', jobId: job.id, preview }, { status: 202 });
}
