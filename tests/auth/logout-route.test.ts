/**
 * Unit tests for `app/(auth)/logout/route.ts` (ADR-0002 cycle 3, t5).
 *
 * Run locally:    pnpm test tests/auth/logout-route.test.ts
 * Prerequisites:  none — pure module mocks.
 *
 * Spec: docs/specs/0002-authentication-implementation.md AC5 (Logout).
 *   - POST: calls `supabase.auth.signOut()` then redirects to `/`. The
 *     redirect uses HTTP 303 — POST→GET semantics for the home page.
 *   - GET: returns 405 Method Not Allowed with `Allow: POST` header. This
 *     is the CSRF defense — logout MUST NOT be triggerable via a cross-
 *     origin `<img src="/logout">` or `<a href="/logout">`. The dashboard
 *     emits a `<form method="post" action="/logout">` button, never an
 *     anchor link.
 *
 * The GET-MUST-NOT-CALL-signOut contract is load-bearing. If a future
 * "convenience" refactor lets GET also clear the session, every external
 * site can log every user out by embedding `<img src="/logout">`. The
 * test below pins the invariant.
 *
 * The SUT calls `createClient()` SYNCHRONOUSLY (per
 * `lib/supabase/server.ts`). The mock factory returns a plain object (not
 * a Promise). See confirm-route.test.ts for the same rationale.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Hoisted mocks: declared at vi.mock-hoist phase so the factory below can
// reference them safely.
const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { signOut: mocks.signOut } }),
}));

// Import AFTER vi.mock so the SUT picks up the mocked module.
import { GET, POST } from '@/app/(auth)/logout/route';

// Helper: build a POST NextRequest. The SUT reads `request.url` to
// construct the absolute redirect target via `new URL('/', request.url)`.
const makePostRequest = (): NextRequest =>
  new NextRequest(new URL('/logout', 'http://localhost:3000'), { method: 'POST' });

beforeEach(() => {
  mocks.signOut.mockReset();
});

describe('logout route', () => {
  it('POST signs out and redirects to /', async () => {
    expect.assertions(4);
    mocks.signOut.mockResolvedValueOnce({ error: null });

    const req = makePostRequest();
    const response = await POST(req);

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    // NextResponse.redirect emits a 3xx. The SUT is documented as 303
    // (POST→GET) — accept the 303/307 family to stay tolerant of any
    // future status tweak that still preserves redirect semantics.
    expect([303, 307]).toContain(response.status);
    const location = response.headers.get('location');
    expect(location).not.toBeNull();
    // The Location header is an absolute URL (NextResponse.redirect
    // builds via `new URL('/', request.url)`). Match the path portion.
    expect(new URL(location as string).pathname).toBe('/');
  });

  it('GET returns 405 with Allow: POST header (CSRF defense)', async () => {
    expect.assertions(3);

    const response = await GET();

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    // LOAD-BEARING: GET MUST NOT clear the session. If this assertion
    // ever flips, every external site can log every user out via
    // `<img src="https://app/logout">`. Do not weaken.
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('POST status code is exactly 303 (POST→GET redirect semantics)', async () => {
    // The 303 vs 307 distinction matters: 307 preserves the request
    // method on the redirect target, which would re-POST the form to
    // `/`. 303 explicitly converts to GET, which is what we want for a
    // marketing home page that does not accept POST. Pin the exact
    // status as a regression guard.
    expect.assertions(1);
    mocks.signOut.mockResolvedValueOnce({ error: null });

    const req = makePostRequest();
    const response = await POST(req);

    expect(response.status).toBe(303);
  });
});
