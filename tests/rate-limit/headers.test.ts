import { describe, it, expect } from 'vitest';
import { rateLimitHeaders } from '@/lib/rate-limit/headers';

describe('rateLimitHeaders', () => {
  it('serializes the three RFC-style headers', () => {
    const h = rateLimitHeaders({
      allowed: true,
      limit: 60,
      remaining: 42,
      reset_at_ms: 1_700_000_000_000,
    });
    expect(h['X-RateLimit-Limit']).toBe('60');
    expect(h['X-RateLimit-Remaining']).toBe('42');
    expect(h['X-RateLimit-Reset']).toBe('1700000000');
  });

  it('rounds the reset time UP to the nearest second (so retries land after the actual reset)', () => {
    const h = rateLimitHeaders({
      allowed: false,
      limit: 60,
      remaining: 0,
      reset_at_ms: 1_700_000_000_500, // 500 ms past the second boundary
    });
    expect(h['X-RateLimit-Reset']).toBe('1700000001');
  });
});
