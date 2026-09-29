import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createWorkspace, EmailTakenError } from '@/server/repositories/organization-repository';
import { getMessages } from '@/server/i18n';
import { appUrl } from '@/server/mail';
import { clientIp, limitOrNull } from '@/server/rate-limit';
import { sendVerificationMail } from '@/server/services/account-mail';

const schema = z.object({
  organizationName: z.string().trim().min(1, '워크스페이스 이름을 입력하세요.').max(50),
  segment: z.enum(['DAILY_SYNC', 'PERIODIC_COUNT', 'ORDER_CYCLE']),
  adminName: z.string().trim().min(1, '이름을 입력하세요.').max(50),
  email: z.string().trim().email('이메일 형식을 확인하세요.'),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.').max(200),
  acceptTerms: z.literal(true, { message: '이용약관과 개인정보 처리방침에 동의해 주세요.' }),
});

/** 누구나 호출할 수 있는 공개 엔드포인트 — 새 워크스페이스와 그 첫 관리자만 만들 수 있고, 기존 조직에는 합류할 수 없다. */
export async function POST(request: Request) {
  const m = await getMessages();
  const limited = limitOrNull(`signup:${clientIp(request)}`, 5, 60 * 60_000, m.account.tooMany);
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' }, { status: 400 });
  }

  let created;
  try {
    created = await createWorkspace(parsed.data);
  } catch (e) {
    if (e instanceof EmailTakenError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
  // 인증 메일이 실패해도 가입은 유지한다 — 앱 안의 안내에서 다시 보낼 수 있다.
  await sendVerificationMail(m, appUrl(request), created.user).catch(() => undefined);
  return NextResponse.json({ ok: true }, { status: 201 });
}
