import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getMessages } from '@/server/i18n';
import { clientIp, limitOrNull } from '@/server/rate-limit';
import { resetPassword } from '@/server/repositories/account-repository';

const schema = z.object({ token: z.string().min(10).max(200), password: z.string().min(8).max(200) });

export async function POST(request: Request) {
  const m = await getMessages();
  const limited = limitOrNull(`reset-confirm:${clientIp(request)}`, 20, 15 * 60_000, m.account.tooMany);
  if (limited) return limited;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: m.account.failed }, { status: 400 });
  if (!(await resetPassword(parsed.data.token, parsed.data.password))) return NextResponse.json({ error: m.account.linkInvalid }, { status: 400 });
  return NextResponse.json({ ok: true });
}
