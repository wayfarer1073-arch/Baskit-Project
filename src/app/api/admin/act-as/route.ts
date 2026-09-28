import { NextResponse } from 'next/server';
import { ACT_AS_COOKIE } from '@/server/tenant';
import { SEGMENT_COOKIE } from '@/lib/segments';

/** 들어가 있던 워크스페이스에서 나와 운영자 본인의 워크스페이스로 돌아간다. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ACT_AS_COOKIE);
  res.cookies.delete(SEGMENT_COOKIE);
  return res;
}
