import { createHash, randomBytes } from 'node:crypto';

/** 메일 링크용 토큰. 원문은 링크에만, DB에는 해시만 저장한다. */
export function createOneTimeToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashOneTimeToken(raw) };
}

export function hashOneTimeToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
