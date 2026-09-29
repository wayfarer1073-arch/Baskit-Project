import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getMessages } from '@/server/i18n';
import { appUrl } from '@/server/mail';
import { clientIp, limitOrNull } from '@/server/rate-limit';
import { requestPasswordReset } from '@/server/repositories/account-repository';
import { sendPasswordResetMail } from '@/server/services/account-mail';

const schema = z.object({ email: z.string().trim().email().max(200) });

/** 재설정 링크 요청. 가입 여부를 드러내지 않도록 결과와 관계없이 같은 응답을 준다. */
export async function POST(request: Request) {
  const m = await getMessages();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: m.account.failed }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  const limited = limitOrNull(`reset-ip:${clientIp(request)}`, 10, 15 * 60_000, m.account.tooMany) ?? limitOrNull(`reset-email:${email}`, 3, 60 * 60_000, m.account.tooMany);
  if (limited) return limited;
  const target = await requestPasswordReset(email);
  if (target) await sendPasswordResetMail(m, appUrl(request), target);
  return NextResponse.json({ ok: true });
}
