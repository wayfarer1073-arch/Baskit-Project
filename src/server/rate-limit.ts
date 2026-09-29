/**
 * 간단한 고정 창(fixed window) 요청 제한. 서버 인스턴스 메모리에 두므로 여러 대로 늘리면 인스턴스마다 따로 센다 —
 * 그때는 Redis 등 공유 저장소로 바꾼다. 로그인·가입·메일 발송처럼 남용되기 쉬운 곳에만 쓴다.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) return { ok: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  return { ok: true, retryAfterSeconds: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}

/** 프록시 뒤에서도 클라이언트 IP를 최대한 찾는다(없으면 'unknown'으로 한데 묶인다). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/** 제한되면 429 응답을, 아니면 null을 돌려준다. */
export function limitOrNull(key: string, limit: number, windowMs: number, message: string): Response | null {
  const r = rateLimit(key, limit, windowMs);
  if (r.ok) return null;
  return Response.json({ error: message }, { status: 429, headers: { 'Retry-After': String(r.retryAfterSeconds) } });
}
