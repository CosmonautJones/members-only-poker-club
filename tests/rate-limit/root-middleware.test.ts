/**
 * Root middleware wiring tests for ADR-0016 AC5.
 *
 * The acceptance criterion: the project-root `middleware.ts` MUST call
 * `applyRateLimit('anonymous', ip:<ip>)` for every matched route, attach
 * `X-RateLimit-*` headers to the response, and return a 429 with the
 * structured JSON body when `RATE_LIMIT_MODE=enforce` and `decision.allowed
 * === false`. Monitor-only (the default) attaches headers but passes through.
 *
 * Run locally:    pnpm test tests/rate-limit/root-middleware.test.ts
 * Prerequisites:  none — pure module mocks.
 *
 * Why this lives in tests/rate-limit/ (not tests/auth/): the SUT contract
 * here is the rate-limit wiring, not the auth gating. The auth-gating
 * tests in tests/auth/middleware.test.ts still cover their concerns and
 * pass through this code path with monitor-mode allow=true.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  updateSession: vi.fn(),
  applyRateLimit: vi.fn(),
  isEnforceMode: vi.fn(),
}));

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: mocks.updateSession,
}));

vi.mock('@/lib/rate-limit/middleware', async () => {
  // Pull through the real ipFromHeaders + rateLimitedBody, mock the rest.
  const actual = await vi.importActual<typeof import('@/lib/rate-limit/middleware')>(
    '@/lib/rate-limit/middleware',
  );
  return {
    ...actual,
    applyRateLimit: mocks.applyRateLimit,
    isEnforceMode: mocks.isEnforceMode,
  };
});

import { middleware } from '@/middleware';

const makeRequest = (urlStr: string, headers?: Record<string, string>): NextRequest => {
  const req = new NextRequest(new URL(urlStr, 'http://localhost:3000'));
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      req.headers.set(k, v);
    }
  }
  return req;
};

const allowedDecision = {
  decision: { allowed: true, limit: 60, remaining: 59, reset_at_ms: 1_000_000 },
  headers: {
    'X-RateLimit-Limit': '60',
    'X-RateLimit-Remaining': '59',
    'X-RateLimit-Reset': '1000',
  },
};

const blockedDecision = {
  decision: { allowed: false, limit: 60, remaining: 0, reset_at_ms: 2_000_000 },
  headers: {
    'X-RateLimit-Limit': '60',
    'X-RateLimit-Remaining': '0',
    'X-RateLimit-Reset': '2000',
  },
};

beforeEach(() => {
  mocks.updateSession.mockReset();
  mocks.applyRateLimit.mockReset();
  mocks.isEnforceMode.mockReset();
});

describe('root middleware — ADR-0016 AC5 wiring', () => {
  it('calls applyRateLimit with bucket "anonymous" and ip-derived subject', async () => {
    expect.assertions(2);
    mocks.applyRateLimit.mockResolvedValueOnce(allowedDecision);
    mocks.isEnforceMode.mockReturnValue(false);
    mocks.updateSession.mockResolvedValueOnce({ response: NextResponse.next(), user: null });

    const req = makeRequest('/', { 'x-forwarded-for': '203.0.113.7, 198.51.100.2' });
    await middleware(req);

    expect(mocks.applyRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.applyRateLimit).toHaveBeenCalledWith('anonymous', 'ip:203.0.113.7');
  });

  it('attaches X-RateLimit-* headers to the pass-through response (monitor mode)', async () => {
    expect.assertions(3);
    mocks.applyRateLimit.mockResolvedValueOnce(allowedDecision);
    mocks.isEnforceMode.mockReturnValue(false);
    const sentinel = NextResponse.next();
    mocks.updateSession.mockResolvedValueOnce({ response: sentinel, user: null });

    const req = makeRequest('/');
    const result = await middleware(req);

    expect(result.headers.get('X-RateLimit-Limit')).toBe('60');
    expect(result.headers.get('X-RateLimit-Remaining')).toBe('59');
    expect(result.headers.get('X-RateLimit-Reset')).toBe('1000');
  });

  it('passes through (does NOT 429) when allowed=false and NOT in enforce mode', async () => {
    expect.assertions(2);
    mocks.applyRateLimit.mockResolvedValueOnce(blockedDecision);
    mocks.isEnforceMode.mockReturnValue(false);
    const sentinel = NextResponse.next();
    mocks.updateSession.mockResolvedValueOnce({ response: sentinel, user: null });

    const req = makeRequest('/');
    const result = await middleware(req);

    expect(result.status).not.toBe(429);
    // Headers still attached so clients can see they were near/over limit.
    expect(result.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('returns 429 with structured body when allowed=false AND in enforce mode', async () => {
    expect.assertions(5);
    mocks.applyRateLimit.mockResolvedValueOnce(blockedDecision);
    mocks.isEnforceMode.mockReturnValue(true);
    // updateSession must NOT be called when we 429 first.
    mocks.updateSession.mockResolvedValueOnce({ response: NextResponse.next(), user: null });

    const req = makeRequest('/');
    const result = await middleware(req);

    expect(result.status).toBe(429);
    expect(result.headers.get('X-RateLimit-Limit')).toBe('60');
    expect(result.headers.get('Retry-After')).not.toBeNull();
    expect(mocks.updateSession).not.toHaveBeenCalled();
    const body = await result.json();
    expect(body).toMatchObject({ error: 'rate_limited' });
  });

  it('attaches headers to gated redirects too (no-session /dashboard with allowed=true)', async () => {
    expect.assertions(2);
    mocks.applyRateLimit.mockResolvedValueOnce(allowedDecision);
    mocks.isEnforceMode.mockReturnValue(false);
    mocks.updateSession.mockResolvedValueOnce({ response: NextResponse.next(), user: null });

    const req = makeRequest('/dashboard');
    const result = await middleware(req);

    expect([302, 307]).toContain(result.status);
    expect(result.headers.get('X-RateLimit-Limit')).toBe('60');
  });

  it('uses x-real-ip when x-forwarded-for is absent', async () => {
    expect.assertions(1);
    mocks.applyRateLimit.mockResolvedValueOnce(allowedDecision);
    mocks.isEnforceMode.mockReturnValue(false);
    mocks.updateSession.mockResolvedValueOnce({ response: NextResponse.next(), user: null });

    const req = makeRequest('/', { 'x-real-ip': '198.51.100.42' });
    await middleware(req);

    expect(mocks.applyRateLimit).toHaveBeenCalledWith('anonymous', 'ip:198.51.100.42');
  });

  it('falls back to ip:unknown when no proxy headers present', async () => {
    expect.assertions(1);
    mocks.applyRateLimit.mockResolvedValueOnce(allowedDecision);
    mocks.isEnforceMode.mockReturnValue(false);
    mocks.updateSession.mockResolvedValueOnce({ response: NextResponse.next(), user: null });

    const req = makeRequest('/');
    await middleware(req);

    expect(mocks.applyRateLimit).toHaveBeenCalledWith('anonymous', 'ip:unknown');
  });
});
