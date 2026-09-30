import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runRetention } from '@/server/maintenance/retention';

export const dynamic = 'force-dynamic';

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * 보관 기한 정리(하루 한 번). 스케줄러가 `Authorization: Bearer <CRON_SECRET>`으로 부른다
 * (Vercel Cron은 CRON_SECRET이 설정돼 있으면 이 헤더를 자동으로 붙인다). CRON_SECRET이 없으면 동작하지 않는다.
 */
async function handle(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'CRON_SECRET이 설정되지 않았습니다.' }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: '권한이 없습니다.' }, { status: 401 });
  const report = await runRetention();
  return NextResponse.json({ ok: true, report });
}

export const GET = handle;
export const POST = handle;
