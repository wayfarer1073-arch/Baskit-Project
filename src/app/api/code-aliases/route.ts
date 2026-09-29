import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { CodeAliasError, createCodeAlias } from '@/server/repositories/code-alias-repository';
import { codeAliasSchema } from '@/server/validation/import-layout';

/** 파일의 상품코드를 창고의 기존 상품에 연결한다. */
export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const parsed = codeAliasSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값을 확인하세요.' }, { status: 400 });
  try {
    const alias = await createCodeAlias(tenant.orgId, parsed.data);
    if (!alias) return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof CodeAliasError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
