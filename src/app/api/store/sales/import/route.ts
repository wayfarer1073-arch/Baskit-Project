import { NextResponse } from 'next/server';
import { forbidViewer, getTenant } from '@/server/tenant';
import { upsertDailySales } from '@/server/repositories/store-repository';
import { bufferToAoa } from '@/domain/excel/aoa-reader';
import { parseSalesAoa } from '@/domain/excel/sales-parser';
import { todayKstDateString } from '@/lib/date';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DAYS = 1000;

/** 여러 날 매출 양식(날짜·매출)을 올려 한 번에 저장한다. 같은 날짜는 덮어쓴다. */
export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '파일을 선택하세요.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: '파일이 너무 큽니다(최대 5MB).' }, { status: 400 });

  let aoa: string[][];
  try {
    aoa = bufferToAoa(Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json({ error: '파일을 읽을 수 없습니다. 엑셀(.xlsx, .xls) 또는 CSV로 올려 주세요.' }, { status: 400 });
  }
  const { rows, skipped } = parseSalesAoa(aoa, todayKstDateString());
  if (rows.length === 0) return NextResponse.json({ error: '읽을 수 있는 날짜·매출 줄이 없습니다. 양식을 확인해 주세요.', skipped }, { status: 400 });
  if (rows.length > MAX_DAYS) return NextResponse.json({ error: `한 번에 ${MAX_DAYS}일까지만 올릴 수 있습니다.` }, { status: 400 });

  for (const row of rows) await upsertDailySales(tenant.orgId, row.date, row.amount);
  return NextResponse.json({ saved: rows.length, skipped });
}
