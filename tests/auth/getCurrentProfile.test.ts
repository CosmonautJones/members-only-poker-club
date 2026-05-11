/**
 * Unit tests for `lib/auth/getCurrentProfile.ts` (ADR-0002 cycle 3, t1).
 *
 * Run locally:    pnpm test tests/auth/getCurrentProfile.test.ts
 * Prerequisites:  none — pure module mocks, no DB, no network.
 *
 * Spec: docs/specs/0002-authentication-implementation.md AC for t1.
 * Helper under test: lib/auth/getCurrentProfile.ts (React.cache() wrap around
 *   createClient() → auth.getUser() → from('profiles').select(...).single()).
 *
 * What the helper IS responsible for:
 *   - Returns the profile row on the happy path.
 *   - Returns null when there is no session (auth.getUser → user: null).
 *   - Returns null when the profile row is missing or the query errors.
 *   - Memoizes within a single React server render via React.cache().
 *
 * What the helper is NOT responsible for (per t1 contract + the premortem):
 *   - Distinguishing "no session" from "transient profile-read error". The
 *     premortem flags the privilege-downgrade-on-error risk, but the t1
 *     contract is intentionally narrow: getCurrentProfile returns null on
 *     either case. The privilege-escalation defense lives in requireRole's
 *     redirect-vs-throw discrimination (see requireRole.test.ts), NOT here.
 *
 * Mocking strategy:
 *   - vi.mock('react', ...): passthrough EXCEPT `cache` is overridden to
 *     identity. Under vitest's happy-dom env, importing `cache` from `'react'`
 *     yields undefined, so the SUT throws `TypeError: cache is not a function`
 *     at module-load time. The identity passthrough makes the SUT load. The
 *     trade-off is that cross-call dedup is no longer testable at the React
 *     layer in this test (test 5 below switches to a static-source assertion
 *     for the same guard).
 *   - vi.mock('server-only') so the `import 'server-only';` directive at the
 *     top of the SUT does not throw under the test runtime. Mirrors the
 *     pattern used in tests/audit/with-audit.test.ts.
 *   - vi.mock('@/lib/supabase/server') so `createClient()` returns a hand-
 *     built fake whose `auth.getUser` and `from(...).select(...).eq(...)
 *     .single()` chain are vi.fn()s the test can program per-case.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Passthrough mock for `react` with `cache` overridden to identity. vitest
// hoists `vi.mock` calls above all imports, so this applies before the SUT is
// loaded. Without this the SUT throws at module-load time because vitest's
// default test env does not expose React's `cache` (it is a server-only API
// that only the server entry of `react` ships).
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  };
});

// Neutralize `server-only` so importing the SUT does not throw.
vi.mock('server-only', () => ({}));

// Module-level holders we reassign in beforeEach. The vi.mock factory below
// reads from THESE references at call time (not from a stale snapshot), so
// per-test reassignments inside beforeEach are picked up.
const handles: {
  getUser: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  createClient: ReturnType<typeof vi.fn>;
} = {
  // Stubs replaced in beforeEach. Typed loosely on purpose — vitest's vi.fn
  // generic typing fights TS strict mode for chained-builder patterns.
  getUser: vi.fn(),
  single: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  createClient: vi.fn(),
};

vi.mock('@/lib/supabase/server', () => {
  return {
    createClient: (...args: unknown[]) => handles.createClient(...args),
  };
});

// Import AFTER vi.mock calls so the SUT picks up the mocked module.
import { getCurrentProfile } from '@/lib/auth/getCurrentProfile';

beforeEach(() => {
  // Fresh fns every test so call counts and programmed return values do not
  // bleed across cases.
  handles.single = vi.fn();
  handles.eq = vi.fn(() => ({ single: handles.single }));
  handles.select = vi.fn(() => ({ eq: handles.eq }));
  handles.from = vi.fn(() => ({ select: handles.select }));
  handles.getUser = vi.fn();
  handles.createClient = vi.fn(async () => ({
    auth: { getUser: handles.getUser },
    from: handles.from,
  }));
});

describe('getCurrentProfile — no session', () => {
  it('returns null when auth.getUser returns user: null and does NOT query profiles', async () => {
    handles.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const result = await getCurrentProfile();

    expect(result).toBeNull();
    // Critical anti-leak invariant: if there's no session, we must NOT touch
    // the profiles table at all. A future contributor who "optimizes" by
    // pre-fetching profiles before the user check would land on a quiet
    // privilege-confusion bug. This assertion fails loudly in that case.
    expect(handles.from).not.toHaveBeenCalled();
    expect(handles.select).not.toHaveBeenCalled();
  });
});

describe('getCurrentProfile — session exists, profile missing', () => {
  it('returns null when single() returns data: null with PGRST116 (no rows)', async () => {
    handles.getUser.mockResolvedValueOnce({
      data: { user: { id: 'uuid-missing' } },
      error: null,
    });
    handles.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows returned' },
    });

    const result = await getCurrentProfile();
    expect(result).toBeNull();
    // The query path WAS taken — we only short-circuit at the user check.
    expect(handles.from).toHaveBeenCalledWith('profiles');
    expect(handles.eq).toHaveBeenCalledWith('id', 'uuid-missing');
  });
});

describe('getCurrentProfile — happy path', () => {
  it('returns the profile shape when session and profile row both present', async () => {
    handles.getUser.mockResolvedValueOnce({
      data: { user: { id: 'uuid-a' } },
      error: null,
    });
    const profileRow = {
      id: 'uuid-a',
      full_name: 'Alice',
      email: 'a@x.com',
      role: 'member' as const,
    };
    handles.single.mockResolvedValueOnce({ data: profileRow, error: null });

    const result = await getCurrentProfile();

    expect(result).toEqual(profileRow);
    expect(handles.from).toHaveBeenCalledWith('profiles');
    // The first arg to .select() is the column list — assert presence of
    // each expected column without pinning exact whitespace/order.
    expect(handles.select).toHaveBeenCalledTimes(1);
    const selectArg = handles.select.mock.calls[0]![0] as string;
    expect(selectArg).toContain('id');
    expect(selectArg).toContain('full_name');
    expect(selectArg).toContain('email');
    expect(selectArg).toContain('role');
    expect(handles.eq).toHaveBeenCalledWith('id', 'uuid-a');
  });
});

describe('getCurrentProfile — profile select errors', () => {
  it('returns null when the profiles select errors out (per t1 contract)', async () => {
    // Per the premortem, the privilege-downgrade-on-error concern is handled
    // separately in requireRole — getCurrentProfile itself simply returns
    // null on any error path. This test pins THAT contract so the worker
    // can't silently change it without flagging the regression.
    handles.getUser.mockResolvedValueOnce({
      data: { user: { id: 'uuid-err' } },
      error: null,
    });
    handles.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection lost' },
    });

    const result = await getCurrentProfile();
    expect(result).toBeNull();
  });
});

describe('getCurrentProfile — React.cache wrap (static-source assertion)', () => {
  // TODO(test-infra): Iter 1 attempted to assert cross-call dedup at runtime
  // by counting mock calls after two awaits. That is not testable under our
  // vitest setup: the SUT throws `TypeError: cache is not a function` at
  // module-load time without a passthrough mock for `react`, and the
  // passthrough mock returns `cache(fn) === fn`, which removes the dedup
  // behavior entirely. The runtime dedup contract is therefore enforced by
  // the inline contract comment in the SUT (see lib/auth/getCurrentProfile.ts
  // top-of-file CONTRACT block) and by code review, not by this test.
  //
  // What this test DOES guard, statically: that the helper is wrapped in
  // React.cache() AND that no module-level state has crept into the file.
  // A future contributor unwrapping `cache(...)` or sneaking in a
  // module-level Map/WeakMap/LRU/globalThis cache would fail this assertion.
  // Same pattern as t0's anti-leak source-grep test for lib/supabase/admin.
  it('SUT wraps the helper in React.cache and contains no module-level state', () => {
    const sutPath = path.resolve(__dirname, '..', '..', 'lib', 'auth', 'getCurrentProfile.ts');
    const source = readFileSync(sutPath, 'utf8');

    // Positive guard: the React.cache() wrap is present.
    expect(source).toMatch(/cache\s*\(/);

    // Negative guards: no module-level cache shapes. These greps are loose
    // (file-wide) on purpose — any of these patterns showing up anywhere in
    // the SUT is a smell worth flagging in review, even inside a function
    // body. If a future use case legitimately needs one of these, update
    // this test deliberately.
    expect(source).not.toMatch(/globalThis\./);
    expect(source).not.toMatch(/new\s+Map\s*\(/);
    expect(source).not.toMatch(/new\s+WeakMap\s*\(/);
    expect(source).not.toMatch(/new\s+LRU\s*\(/);
  });
});
