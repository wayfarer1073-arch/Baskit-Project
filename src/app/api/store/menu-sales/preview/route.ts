import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { bufferToAoa, SpreadsheetRejectedError, tooManyRowsMessage } from '@/domain/excel/aoa-reader';
import { MAX_UPLOAD_DATA_ROWS } from '@/lib/upload-limits';
import { MENU_SALES_FIELDS } from '@/domain/excel/menu-sales-fields';
import { previewMenuSales } from '@/server/services/menu-service';
import { isDateString } from '@/lib/date';

const MAX_BYTES = 5 * 1024 * 1024;

const layoutSchema = z.object({
  headerRowIndex: z.number().int().min(0).max(100),
  columns: z.object(Object.fromEntries(MENU_SALES_FIELDS.map((f) => [f, z.string().max(200).optional()]))),
});

/** 메뉴 판매 파일 미리보기 — 열(양식)을 정하고 메뉴 이름을 맞춰 본다. 저장은 하지 않는다. */
export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '파일을 선택하세요.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: '파일이 너무 큽니다(최대 5MB).' }, { status: 400 });

  let layout = null;
  const rawLayout = form?.get('layout');
  if (typeof rawLayout === 'string' && rawLayout) {
    let json: unknown = null;
    try {
      json = JSON.parse(rawLayout);
    } catch {
      // 아래에서 형식 오류로 돌려준다.
    }
    const parsed = layoutSchema.safeParse(json);
    if (!parsed.success) return NextResponse.json({ error: '열 지정이 올바르지 않습니다.' }, { status: 400 });
    layout = parsed.data;
  }
  const rawDate = form?.get('date');
  const date = typeof rawDate === 'string' && isDateString(rawDate) ? rawDate : null;

  let aoa: string[][];
  try {
    aoa = bufferToAoa(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof SpreadsheetRejectedError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: '파일을 읽을 수 없습니다. 엑셀(.xlsx, .xls) 또는 CSV로 올려 주세요.' }, { status: 400 });
  }
  if (aoa.length - 1 > MAX_UPLOAD_DATA_ROWS) return NextResponse.json({ error: tooManyRowsMessage(aoa.length - 1) }, { status: 400 });
  return NextResponse.json(await previewMenuSales(tenant.orgId, aoa, { layout, date }));
}
