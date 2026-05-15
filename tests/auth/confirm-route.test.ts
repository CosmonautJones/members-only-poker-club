/**
 * Unit tests for `app/(auth)/confirm/route.ts:GET` (ADR-0002 cycle 3, t5).
 *
 * Run locally:    pnpm test tests/auth/confirm-route.test.ts
 * Prerequisites:  none — pure module mocks.
 *
 * Spec: docs/specs/0002-authentication-implementation.md AC4 (Email-link
 *       confirmation). Mirrors the canonical Supabase Next.js docs pattern:
 *       GET handler reads `token_hash` + `type` from the query string,
 *       calls `supabase.auth.verifyOtp({ token_hash, type })`, and:
 *         - on success → 307 redirect to `/dashboard`
 *         - on failure (verifyOtp error OR missing params) → 307 redirect
 *           to `/auth-code-error`
 *
 *       The error-page path is `/auth-code-error` (the segment lives at
 *       `app/(auth)/auth-code-error/page.tsx`; `(auth)` is a route group
 *       and is NOT part of the URL pathname).
 *
 * Mocking strategy mirrors the t1 iter-2 + t2 patterns: `vi.hoisted` to
 * dodge the hoisting trap where vi.mock factories run before module-scope
 * `const` declarations. See tests/auth/requireRole.test.ts for the
 * canonical write-up.
 *
 * The SUT calls `createClient()` SYNCHRONOUSLY (per
 * `lib/supabase/server.ts`). The mock factory therefore returns a plain
 * object (not a Promise). Using `async () => ({...})` would force the SUT
 * to `await` the client which it does not — and the test would silently
 * pass while the real production code path is broken.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Hoisted mocks: declared at vi.mock-hoist phase so the factory below can
// reference them safely. Test bodies access via `mocks.<name>`.
const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
}));

// revalidatePath is called between verifyOtp and the 307 redirect so
// the (member) layout reads the freshly-set session cookie. Stub it —
// the real impl requires Next's static-generation store which is absent.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { verifyOtp: mocks.verifyOtp } }),
}));

// Import AFTER vi.mock so the SUT picks up the mocked module.
import { GET } from '@/app/(auth)/confirm/route';

// Helper: build a real NextRequest at the given URL. NextRequest exposes
// `nextUrl.searchParams` which the SUT reads.
const makeRequest = (urlStr: string): NextRequest =>
  new NextRequest(new URL(urlStr, 'http://localhost:3000'));

beforeEach(() => {
  mocks.verifyOtp.mockReset();
});

describe('confirm route GET', () => {
  it('happy path: token_hash + type=signup → verifyOtp ok → 307 redirect to /dashboard', async () => {
    expect.assertions(4);
    mocks.verifyOtp.mockResolvedValueOnce({ error: null });

    const req = makeRequest('/confirm?token_hash=abc&type=signup');
    const response = await GET(req);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/dashboard');
    expect(mocks.verifyOtp).toHaveBeenCalledTimes(1);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'signup' });
  });

  it('type=recovery also works: verifyOtp ok → 307 redirect to /dashboard', async () => {
    // The canonical Supabase confirm pattern accepts `signup`,
    // `magiclink`, `recovery`, `invite`, `email_change`. Pin that the
    // route does NOT silently filter to `signup` only.
    expect.assertions(3);
    mocks.verifyOtp.mockResolvedValueOnce({ error: null });

    const req = makeRequest('/confirm?token_hash=abc&type=recovery');
    const response = await GET(req);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/dashboard');
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'recovery' });
  });

  it('verifyOtp errors → 307 redirect to /auth-code-error', async () => {
    expect.assertions(3);
    mocks.verifyOtp.mockResolvedValueOnce({ error: { message: 'invalid token' } });

    const req = makeRequest('/confirm?token_hash=abc&type=signup');
    const response = await GET(req);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/auth-code-error');
    // verifyOtp WAS called — the failure came from Supabase, not from
    // the param-presence guard.
    expect(mocks.verifyOtp).toHaveBeenCalledTimes(1);
  });

  it('missing token_hash → redirect to /auth-code-error WITHOUT calling verifyOtp', async () => {
    expect.assertions(3);

    // No token_hash query param. Type is present.
    const req = makeRequest('/confirm?type=signup');
    const response = await GET(req);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/auth-code-error');
    // The guard MUST short-circuit before any Supabase call. This is
    // the cheap-rejection contract — never let a missing/forged param
    // reach `verifyOtp`.
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('missing type → redirect to /auth-code-error WITHOUT calling verifyOtp', async () => {
    expect.assertions(3);

    // token_hash present, but no type.
    const req = makeRequest('/confirm?token_hash=abc');
    const response = await GET(req);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/auth-code-error');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('both missing → redirect to /auth-code-error WITHOUT calling verifyOtp', async () => {
    expect.assertions(3);

    // Empty query string — direct GET to /confirm with no params.
    const req = makeRequest('/confirm');
    const response = await GET(req);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/auth-code-error');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
});
