import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getMessages } from '@/server/i18n';
import { clientIp, limitOrNull } from '@/server/rate-limit';
import { acceptInvitation, InvitationError } from '@/server/repositories/account-repository';

const schema = z.object({
  token: z.string().min(10).max(200),
  name: z.string().trim().min(1).max(50),
  password: z.string().min(8).max(200),
  acceptTerms: z.literal(true),
});

export async function POST(request: Request) {
  const m = await getMessages();
  const limited = limitOrNull(`invite-accept:${clientIp(request)}`, 20, 15 * 60_000, m.account.tooMany);
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const termsMissing = parsed.error.issues.some((i) => i.path[0] === 'acceptTerms');
    return NextResponse.json({ error: termsMissing ? m.account.mustAgree : m.account.failed }, { status: 400 });
  }
  try {
    const user = await acceptInvitation(parsed.data.token, { name: parsed.data.name, password: parsed.data.password });
    return NextResponse.json({ ok: true, email: user.email }, { status: 201 });
  } catch (e) {
    if (e instanceof InvitationError)
      return NextResponse.json({ error: e.code === 'email_taken' ? m.account.emailTaken : m.account.inviteInvalid }, { status: e.code === 'email_taken' ? 409 : 400 });
    throw e;
  }
}
