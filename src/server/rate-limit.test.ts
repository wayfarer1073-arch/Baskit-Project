import { beforeEach, expect, it } from 'vitest';
import { rateLimit, resetRateLimits } from './rate-limit';

beforeEach(() => resetRateLimits());

it('allows up to the limit within a window and resets afterwards', () => {
  const t0 = 1_000_000;
  expect(rateLimit('k', 2, 1000, t0).ok).toBe(true);
  expect(rateLimit('k', 2, 1000, t0 + 10).ok).toBe(true);
  const blocked = rateLimit('k', 2, 1000, t0 + 20);
  expect(blocked.ok).toBe(false);
  expect(blocked.retryAfterSeconds).toBe(1);
  expect(rateLimit('other', 2, 1000, t0 + 20).ok).toBe(true);
  expect(rateLimit('k', 2, 1000, t0 + 1001).ok).toBe(true);
});
