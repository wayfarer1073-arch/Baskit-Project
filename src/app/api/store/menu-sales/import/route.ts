import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { MENU_SALES_FIELDS } from '@/domain/excel/menu-sales-fields';
import { DuplicateReceiptError, importMenuSales, saveMenuSalesTemplate, touchMenuSalesTemplate } from '@/server/repositories/menu-repository';
import { isDateString, todayKstDateString } from '@/lib/date';

const name = z.string().trim().min(1).max(100);
const schema = z.object({
  lines: z
    .array(z.object({ date: z.string().refine(isDateString, '날짜를 확인하세요.'), name, quantity: z.number().min(-100_000).max(100_000), amount: z.number().nullable() }))
    .min(1, '저장할 판매가 없습니다.')
    .max(5000),
  decisions: z
    .array(
      z.discriminatedUnion('action', [
        z.object({ action: z.literal('menu'), name, code: z.string().max(50).nullable(), menuId: z.string().min(1) }),
        z.object({ action: z.literal('new'), name, code: z.string().max(50).nullable() }),
        z.object({ action: z.literal('ignore'), name, code: z.string().max(50).nullable() }),
      ]),
    )
    .max(1000),
  /** 이 파일의 열 지정을 양식으로 저장(같은 머리글 파일에 자동 적용). */
  template: z
    .object({
      save: z.boolean(),
      name: z.string().trim().min(1).max(60),
      headers: z.array(z.string().max(200)).max(200),
      layout: z.object({
        headerRowIndex: z.number().int().min(0).max(100),
        columns: z.object(Object.fromEntries(MENU_SALES_FIELDS.map((f) => [f, z.string().max(200).optional()]))),
      }),
    })
    .nullable()
    .default(null),
  /** replace: 같은 날·같은 메뉴 덮어쓰기(파일·마감 정산서), add: 기존 판매에 더하기(손님 영수증). */
  mode: z.enum(['replace', 'add']).default('replace'),
  /** 더하기로 저장하는 영수증의 표시 — 같은 영수증을 두 번 더하지 않는다. */
  receipt: z
    .object({ date: z.string().refine(isDateString), key: z.string().trim().min(1).max(100) })
    .nullable()
    .default(null),
});

/** 메뉴 판매 저장 — 새 메뉴 만들기·이름 연결 기억·같은 날 같은 메뉴 덮어쓰기(손님 영수증은 더하기). */
export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  const { lines, decisions, template, mode, receipt } = parsed.data;
  if (lines.some((l) => l.date > todayKstDateString())) return NextResponse.json({ error: '미래 날짜의 판매는 저장할 수 없습니다.' }, { status: 400 });

  let result;
  try {
    result = await importMenuSales(tenant.orgId, { lines, decisions, mode, receipt: mode === 'add' ? receipt : null });
  } catch (e) {
    if (e instanceof DuplicateReceiptError) return NextResponse.json({ error: '이미 더한 영수증이에요. 같은 영수증은 한 번만 저장돼요.' }, { status: 409 });
    throw e;
  }
  if (!result) return NextResponse.json({ error: '메뉴를 찾을 수 없습니다.' }, { status: 404 });
  if (template?.save) await saveMenuSalesTemplate(tenant.orgId, template.name, template.headers, template.layout);
  else if (template) await touchMenuSalesTemplate(tenant.orgId, template.headers);
  return NextResponse.json({ ok: true, ...result });
}
