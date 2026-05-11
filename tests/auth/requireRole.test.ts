/**
 * Unit tests for `lib/auth/requireRole.ts` (ADR-0002 cycle 3, t1).
 *
 * Run locally:    pnpm test tests/auth/requireRole.test.ts
 * Prerequisites:  none — pure module mocks.
 *
 * Spec: docs/specs/0002-authentication-implementation.md AC for t1.
 *       ADR-0003 role hierarchy: member<cashier<manager<owner.
 *
 * Helper under test: lib/auth/requireRole.ts. Contract:
 *   - If getCurrentProfile() returns null → redirect('/login?next=...') with
 *     pathname+search encoded; MUST NOT throw InsufficientRoleError.
 *   - If profile.role rank < required role rank → throw
 *     InsufficientRoleError(required, actual); MUST NOT redirect.
 *   - If profile.role rank ≥ required role rank → return { profile }.
 *
 * The redirect-vs-throw discrimination is LOAD-BEARING (premortem invariant
 * "never collapse the two branches"). Test 8 below pins it explicitly.
 *
 * Mocking strategy:
 *   - vi.mock('server-only') — neutralize the build-time guard import.
 *   - vi.mock('./getCurrentProfile') — program the profile that requireRole
 *     sees per-test. The SUT imports `from './getCurrentProfile'` (relative);
 *     we mirror that path here so vitest's module ID hashing matches.
 *   - vi.mock('next/navigation', { redirect }) — Next.js's real `redirect`
 *     throws a sentinel internally; our mock throws a typed error
 *     (RedirectError) the test can match via `rejects.toBeInstanceOf` AND
 *     inspect via `mocks.redirect.mock.calls`.
 *   - vi.mock('next/headers', { headers }) — mock object with a `get` fn the
 *     tests program per-case for x-pathname / x-search headers.
 *   - We do NOT mock `./errors` — the real `InsufficientRoleError` class is
 *     imported so `expect(...).toBeInstanceOf(InsufficientRoleError)` matches
 *     the same constructor the SUT throws. Mocking it would make the
 *     discrimination test (8) a tautology.
 *
 * vi.hoisted note: vi.mock factory bodies are hoisted to the top of the file,
 * which means they run BEFORE any module-scope `const` declaration. Iter 1
 * tripped on this — the factory referenced a `const getCurrentProfileMock`
 * that didn't exist yet at hoist time, throwing
 * `ReferenceError: Cannot access 'getCurrentProfileMock' before initialization`.
 * The fix is `vi.hoisted(() => ({...}))`, which lets us declare mock fns
 * inside the hoisted block so they're initialized at the same hoist phase as
 * the factories that reference them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks: declared at vi.mock-hoist phase so the factories below can
// reference them safely. Test bodies access these via `mocks.<name>` after
// imports have run.
//
// The mocked `redirect` throws a plain Error with name='RedirectError' to
// mirror Next.js's internal NEXT_REDIRECT sentinel. We attach a `digest`
// property of the form `NEXT_REDIRECT;<target>` to match the real shape, in
// case future tests want to introspect it. Tests recognize the throw by
// asserting `(err as Error).name === 'RedirectError'` rather than by
// `instanceof` — vi.hoisted bodies cannot reference a class declared at
// module scope (because they run BEFORE module scope evaluates), so a
// hand-rolled name check is the simplest reliable signal.
const mocks = vi.hoisted(() => {
  return {
    getCurrentProfile: vi.fn(),
    redirect: vi.fn((target: string) => {
      const err = new Error(`NEXT_REDIRECT: ${target}`);
      err.name = 'RedirectError';
      (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;${target}`;
      throw err;
    }),
    headersGet: vi.fn<(name: string) => string | null>(),
  };
});

// Neutralize `server-only`.
vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

vi.mock('next/headers', () => ({
  headers: async () => ({ get: mocks.headersGet }),
}));

// Mock the colocated profile getter using the SAME relative path the SUT
// uses. The SUT (`lib/auth/requireRole.ts`) imports `from './getCurrentProfile'`,
// and vitest hashes module mocks by resolved path, so the relative path here
// resolves to the same module. We also mock the `@/` alias variant so any
// future call site that uses the alias still gets the mock.
vi.mock('./getCurrentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));
vi.mock('@/lib/auth/getCurrentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

// Imports AFTER vi.mock so the SUT picks up the mocked modules.
import { requireRole, type Role } from '@/lib/auth/requireRole';
import { InsufficientRoleError } from '@/lib/auth/errors';

// Helper: build a profile with the role you specify and otherwise-valid
// fields. Tests that don't care about the non-role fields use this to keep
// each `it()` short.
type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
};
const makeProfile = (role: Role, overrides: Partial<Profile> = {}): Profile => ({
  id: 'uuid-test',
  full_name: 'Test User',
  email: 'test@example.com',
  role,
  ...overrides,
});

// Helper: program the headers mock with a {name -> value} map. Anything not
// in the map returns null. Replaces the prior `headerMap` Map approach.
const setHeaders = (entries: Record<string, string>) => {
  mocks.headersGet.mockImplementation((name: string) => entries[name] ?? null);
};

beforeEach(() => {
  // Reset call history AND clear programmed return values so a leftover
  // mockResolvedValueOnce from a prior test doesn't bleed into this one.
  mocks.redirect.mockClear();
  mocks.getCurrentProfile.mockReset();
  mocks.headersGet.mockReset();
  // Default headers: x-pathname falls back to '/' inside the SUT, no search.
  mocks.headersGet.mockImplementation(() => null);
});

describe('requireRole — no session redirects to /login?next=...', () => {
  it('redirects to /login?next=%2Fdashboard when no session and pathname is /dashboard', async () => {
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce(null);
    setHeaders({ 'x-pathname': '/dashboard' });

    // Our redirect mock throws an Error with name='RedirectError'. We can't
    // use toBeInstanceOf(RedirectError) here because the thrown error is a
    // plain Error (the hoisted block can't reference the outer class), so
    // assert via the name property.
    await expect(requireRole('member')).rejects.toMatchObject({
      name: 'RedirectError',
    });

    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    const target = mocks.redirect.mock.calls[0]![0] as string;
    expect(target).toBe('/login?next=%2Fdashboard');
  });

  it('does NOT throw InsufficientRoleError on the no-session path', async () => {
    expect.assertions(2);
    mocks.getCurrentProfile.mockResolvedValueOnce(null);
    setHeaders({ 'x-pathname': '/dashboard' });

    // The thrown error must be the redirect sentinel, NOT
    // InsufficientRoleError. This pins the premortem invariant
    // "never collapse the two branches."
    let caught: unknown;
    try {
      await requireRole('owner');
    } catch (e) {
      caught = e;
    }
    expect((caught as Error)?.name).toBe('RedirectError');
    expect(caught).not.toBeInstanceOf(InsufficientRoleError);
  });
});

describe('requireRole — redirect path includes search string', () => {
  it('encodes pathname AND search into the next param', async () => {
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce(null);
    setHeaders({ 'x-pathname': '/admin/users', 'x-search': '?page=2' });

    await expect(requireRole('manager')).rejects.toMatchObject({
      name: 'RedirectError',
    });

    const target = mocks.redirect.mock.calls[0]![0] as string;
    // %2F = "/", %3F = "?", %3D = "=".
    expect(target).toContain('%2Fadmin%2Fusers');
    expect(target).toContain('page%3D2');
  });
});

describe('requireRole — role rank too low throws InsufficientRoleError', () => {
  it('member calling requireRole(owner) throws with required=owner, actual=member', async () => {
    expect.assertions(4);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('member'));

    let caught: unknown;
    try {
      await requireRole('owner');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(InsufficientRoleError);
    const err = caught as InsufficientRoleError;
    expect(err.required).toBe('owner');
    expect(err.actual).toBe('member');
    // And critically: redirect was NOT called on the throw path.
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('requireRole — role meets requirement returns profile', () => {
  it('manager calling requireRole(cashier) returns { profile } with no throw, no redirect', async () => {
    const profile = makeProfile('manager');
    mocks.getCurrentProfile.mockResolvedValueOnce(profile);

    const result = await requireRole('cashier');

    expect(result).toEqual({ profile });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('requireRole — role exceeds requirement returns profile', () => {
  it('manager calling requireRole(member) returns the profile', async () => {
    const profile = makeProfile('manager');
    mocks.getCurrentProfile.mockResolvedValueOnce(profile);

    const result = await requireRole('member');
    expect(result).toEqual({ profile });
  });
});

describe('requireRole — role exactly matches returns profile', () => {
  it('cashier calling requireRole(cashier) returns the profile', async () => {
    const profile = makeProfile('cashier');
    mocks.getCurrentProfile.mockResolvedValueOnce(profile);

    const result = await requireRole('cashier');
    expect(result).toEqual({ profile });
  });
});

describe('requireRole — full 4×4 hierarchy matrix', () => {
  // Premortem R3 mitigation: the role-ladder logic is verified for every
  // (have, need) pair so a hand-rolled string compare or off-by-one in the
  // ladder array cannot survive CI.
  //
  // Tuple shape: [actualRole, requiredRole, expectedToPass]
  // True if rank(actual) >= rank(required); false otherwise.
  it.each<[Role, Role, boolean]>([
    ['member', 'member', true],
    ['member', 'cashier', false],
    ['member', 'manager', false],
    ['member', 'owner', false],
    ['cashier', 'member', true],
    ['cashier', 'cashier', true],
    ['cashier', 'manager', false],
    ['cashier', 'owner', false],
    ['manager', 'member', true],
    ['manager', 'cashier', true],
    ['manager', 'manager', true],
    ['manager', 'owner', false],
    ['owner', 'member', true],
    ['owner', 'cashier', true],
    ['owner', 'manager', true],
    ['owner', 'owner', true],
  ])('actual=%s required=%s passes=%s', async (actual, required, passes) => {
    const profile = makeProfile(actual);
    mocks.getCurrentProfile.mockResolvedValueOnce(profile);

    if (passes) {
      const result = await requireRole(required);
      expect(result).toEqual({ profile });
      expect(mocks.redirect).not.toHaveBeenCalled();
    } else {
      let caught: unknown;
      try {
        await requireRole(required);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InsufficientRoleError);
      const err = caught as InsufficientRoleError;
      expect(err.required).toBe(required);
      expect(err.actual).toBe(actual);
      expect(mocks.redirect).not.toHaveBeenCalled();
    }
  });
});

describe('requireRole — discrimination: redirect vs. throw branches never collide', () => {
  it('no-session takes the redirect path and constructs no InsufficientRoleError', async () => {
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce(null);
    setHeaders({ 'x-pathname': '/admin' });

    let caught: unknown;
    try {
      await requireRole('manager');
    } catch (e) {
      caught = e;
    }
    expect((caught as Error)?.name).toBe('RedirectError');
    expect(caught).not.toBeInstanceOf(InsufficientRoleError);
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });

  it('role-too-low takes the throw path and never calls redirect', async () => {
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('member'));

    let caught: unknown;
    try {
      await requireRole('owner');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InsufficientRoleError);
    // The thrown error is InsufficientRoleError, not the redirect sentinel.
    expect((caught as Error)?.name).not.toBe('RedirectError');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
