import { NextResponse } from 'next/server';
import { getTenant } from '@/server/tenant';
import { getMessages } from '@/server/i18n';
import { appUrl } from '@/server/mail';
import { limitOrNull } from '@/server/rate-limit';
import { getAccountStatus } from '@/server/repositories/account-repository';
import { sendVerificationMail } from '@/server/services/account-mail';

export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const m = await getMessages();
  const limited = limitOrNull(`verify-resend:${tenant.userId}`, 3, 10 * 60_000, m.account.tooMany);
  if (limited) return limited;
  const user = await getAccountStatus(tenant.userId);
  if (!user) return NextResponse.json({ error: m.account.failed }, { status: 404 });
  if (user.emailVerifiedAt) return NextResponse.json({ ok: true, alreadyVerified: true });
  await sendVerificationMail(m, appUrl(request), { id: tenant.userId, email: user.email, name: user.name });
  return NextResponse.json({ ok: true });
}
