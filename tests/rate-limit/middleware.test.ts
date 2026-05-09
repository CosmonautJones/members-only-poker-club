import { describe, it, expect } from 'vitest';
import {
  applyRateLimit,
  ipFromHeaders,
  isEnforceMode,
  rateLimitedBody,
} from '@/lib/rate-limit/middleware';
import { InMemoryStore } from '@/lib/rate-limit/store';

describe('applyRateLimit', () => {
  it('returns a decision and the response headers', async () => {
    const store = new InMemoryStore();
    const result = await applyRateLimit('anonymous', 'ip:1', { store, now: () => 1_000 });
    expect(result.decision.allowed).toBe(true);
    expect(result.headers).toHaveProperty('X-RateLimit-Limit');
    expect(result.headers).toHaveProperty('X-RateLimit-Remaining');
    expect(result.headers).toHaveProperty('X-RateLimit-Reset');
  });

  it('saturates the bucket and reports allowed=false', async () => {
    const store = new InMemoryStore();
    for (let i = 0; i < 60; i++) {
      await applyRateLimit('anonymous', 'ip:saturate', { store, now: () => i });
    }
    const blocked = await applyRateLimit('anonymous', 'ip:saturate', {
      store,
      now: () => 60,
    });
    expect(blocked.decision.allowed).toBe(false);
    expect(blocked.headers['X-RateLimit-Remaining']).toBe('0');
  });
});

describe('ipFromHeaders', () => {
  it('reads the first entry of x-forwarded-for', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 198.51.100.2' });
    expect(ipFromHeaders(h)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip when no XFF', () => {
    const h = new Headers({ 'x-real-ip': '198.51.100.99' });
    expect(ipFromHeaders(h)).toBe('198.51.100.99');
  });

  it('returns "unknown" when no IP headers are present', () => {
    expect(ipFromHeaders(new Headers())).toBe('unknown');
  });
});

describe('isEnforceMode', () => {
  it('returns false when RATE_LIMIT_MODE is unset', () => {
    const original = process.env.RATE_LIMIT_MODE;
    delete process.env.RATE_LIMIT_MODE;
    try {
      expect(isEnforceMode()).toBe(false);
    } finally {
      if (original !== undefined) process.env.RATE_LIMIT_MODE = original;
    }
  });

  it('returns true when RATE_LIMIT_MODE === "enforce"', () => {
    const original = process.env.RATE_LIMIT_MODE;
    process.env.RATE_LIMIT_MODE = 'enforce';
    try {
      expect(isEnforceMode()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.RATE_LIMIT_MODE;
      else process.env.RATE_LIMIT_MODE = original;
    }
  });

  it('returns false for any other value (monitor-only safety net)', () => {
    const original = process.env.RATE_LIMIT_MODE;
    process.env.RATE_LIMIT_MODE = 'monitor';
    try {
      expect(isEnforceMode()).toBe(false);
    } finally {
      if (original === undefined) delete process.env.RATE_LIMIT_MODE;
      else process.env.RATE_LIMIT_MODE = original;
    }
  });
});

describe('rateLimitedBody', () => {
  it('returns retry_after_seconds derived from the decision', () => {
    const body = rateLimitedBody(
      { allowed: false, limit: 60, remaining: 0, reset_at_ms: 1_000_000 },
      900_000,
    );
    expect(body.error).toBe('rate_limited');
    expect(body.retry_after_seconds).toBe(100);
  });

  it('clamps retry_after_seconds to a minimum of 1', () => {
    const body = rateLimitedBody(
      { allowed: false, limit: 60, remaining: 0, reset_at_ms: 100 },
      1_000_000,
    );
    expect(body.retry_after_seconds).toBe(1);
  });
});
