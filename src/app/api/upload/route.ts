import { after, NextResponse } from 'next/server';
import { forbidViewer, getTenant } from '@/server/tenant';
import { processUpload } from '@/server/services/upload-service';
import { resetUploadForDate } from '@/server/repositories/snapshot-repository';
import { todayKstDateString } from '@/lib/date';
import { getWarehouseInOrg } from '@/server/repositories/warehouse-repository';
import { getSegmentSettings } from '@/server/repositories/settings-repository';
import { listHolidayDateStrings } from '@/server/repositories/holiday-repository';
import { isShippingDay } from '@/domain/inventory/shipping-calendar';
import { BACKGROUND_UPLOAD_BYTES, MAX_UPLOAD_BYTES } from '@/lib/upload-limits';
import { createUploadJob, runUploadJob } from '@/server/services/upload-job-service';
import { parseLayoutField, templateNameSchema } from '@/server/validation/import-layout';

export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const formData = await request.formData();
  const warehouseId = formData.get('warehouseId');
  const snapshotDateStr = formData.get('snapshotDate');
  const replaceExisting = formData.get('replaceExisting') === 'true';
  const file = formData.get('file');

  if (typeof warehouseId !== 'string' || typeof snapshotDateStr !== 'string' || !(file instanceof File)) {
    return NextResponse.json({ error: '필수 항목이 누락되었습니다 (창고, 기준일, 파일).' }, { status: 400 });
  }

  if (!(await getWarehouseInOrg(tenant.orgId, warehouseId))) return NextResponse.json({ error: '창고를 찾을 수 없습니다.' }, { status: 404 });

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `파일이 너무 큽니다 (최대 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB).` }, { status: 413 });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDateStr)) {
    return NextResponse.json({ error: '기준일 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const snapshotDate = new Date(`${snapshotDateStr}T00:00:00.000Z`);
  // new Date()는 "2026-02-30" 같은 존재하지 않는 날짜를 3월 2일 등으로 자동 보정하므로,
  // 되돌린 날짜 문자열이 입력과 일치하는지 검사해 실제 달력 날짜인지 확인한다.
  if (Number.isNaN(snapshotDate.getTime()) || snapshotDate.toISOString().slice(0, 10) !== snapshotDateStr) {
    return NextResponse.json({ error: '존재하지 않는 날짜입니다.' }, { status: 400 });
  }
  if (snapshotDateStr > todayKstDateString()) {
    return NextResponse.json({ error: '미래 날짜는 기준일로 선택할 수 없습니다.' }, { status: 400 });
  }

  // 휴무일 업로드가 꺼져 있으면 주말·등록 휴무일에는 받지 않는다(화면과 같은 규칙을 서버에서도 지킨다).
  const { allowNonWorkingDayUploads } = await getSegmentSettings(tenant.orgId);
  if (!allowNonWorkingDayUploads && !isShippingDay(snapshotDateStr, new Set(await listHolidayDateStrings(tenant.orgId)))) {
    return NextResponse.json({ error: '휴무일(주말·등록 휴무일)에는 업로드할 수 없습니다. 설정 > 일일 재고 연동에서 휴무일 업로드를 켤 수 있어요.' }, { status: 400 });
  }

  const layout = parseLayoutField(formData.get('layout'));
  if (layout === null) return NextResponse.json({ error: '양식 정보가 올바르지 않습니다.' }, { status: 400 });
  const templateNameRaw = formData.get('templateName');
  let saveTemplateAs: string | undefined;
  if (typeof templateNameRaw === 'string' && templateNameRaw.trim() !== '') {
    const name = templateNameSchema.safeParse(templateNameRaw);
    if (!name.success) return NextResponse.json({ error: name.error.issues[0]?.message ?? '템플릿 이름을 확인하세요.' }, { status: 400 });
    saveTemplateAs = name.data;
  }

  const arrayBuffer = await file.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);

  const uploadRequest = {
    orgId: tenant.orgId,
    layout,
    saveTemplateAs,
    warehouseId,
    snapshotDate,
    fileBuffer,
    fileName: file.name,
    uploadedById: tenant.userId,
    replaceExisting,
  };

  // 큰 파일은 먼저 접수만 하고 응답 뒤에 처리한다. 화면은 /api/upload/jobs/[id]로 결과를 확인한다.
  if (file.size > BACKGROUND_UPLOAD_BYTES) {
    const job = await createUploadJob({ orgId: tenant.orgId, userId: tenant.userId, warehouseId, snapshotDate, fileName: file.name, fileSize: file.size });
    after(() => runUploadJob(job.id, uploadRequest));
    return NextResponse.json({ status: 'QUEUED', jobId: job.id }, { status: 202 });
  }

  const result = await processUpload(uploadRequest);

  if (result.status === 'ERROR') {
    return NextResponse.json({ status: 'ERROR', issues: result.issues }, { status: 422 });
  }
  if (result.status === 'CONFLICT') {
    return NextResponse.json({ status: 'CONFLICT', existing: result.existing }, { status: 409 });
  }
  return NextResponse.json(result, { status: 200 });
}

/** 일자별 업로드 탭에서 특정 창고·날짜에 올라간 자료 전체를 초기화(삭제)한다. 다른 창고/날짜에는 영향 없음. */
export async function DELETE(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;
  if (!tenant.isAdmin) return NextResponse.json({ error: '관리자만 초기화할 수 있습니다.' }, { status: 403 });

  const url = new URL(request.url);
  const warehouseId = url.searchParams.get('warehouseId');
  const snapshotDateStr = url.searchParams.get('snapshotDate');
  if (!warehouseId || !snapshotDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDateStr)) {
    return NextResponse.json({ error: '창고와 날짜를 지정해야 합니다.' }, { status: 400 });
  }

  const snapshotDate = new Date(`${snapshotDateStr}T00:00:00.000Z`);
  if (Number.isNaN(snapshotDate.getTime()) || snapshotDate.toISOString().slice(0, 10) !== snapshotDateStr) {
    return NextResponse.json({ error: '존재하지 않는 날짜입니다.' }, { status: 400 });
  }

  if (!(await getWarehouseInOrg(tenant.orgId, warehouseId))) return NextResponse.json({ error: '창고를 찾을 수 없습니다.' }, { status: 404 });
  const result = await resetUploadForDate(warehouseId, snapshotDate);
  if (result.deletedSnapshotCount === 0) {
    return NextResponse.json({ error: '해당 날짜에 업로드된 자료가 없습니다.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deletedSnapshotCount: result.deletedSnapshotCount });
}
