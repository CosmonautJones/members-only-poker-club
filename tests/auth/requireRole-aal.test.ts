/**
 * Unit tests for the AAL2 gate inside `lib/auth/requireRole.ts`
 * (ADR-0035 AC4 / t2). The pre-existing rank + redirect behavior is
 * pinned by `tests/auth/requireRole.test.ts` and MUST continue to
 * pass without edits; this file ADDS coverage for the AAL branch
 * only.
 *
 * Run locally:    pnpm test tests/auth/requireRole-aal.test.ts
 * Prerequisites:  none — pure module mocks.
 *
 * Contract under test (the new branch only):
 *   - When required ∈ {'manager','owner'} AND profile rank ≥ required
 *     AND getSessionAal() returns 'aal2'  → returns { profile }.
 *   - When required ∈ {'manager','owner'} AND profile rank ≥ required
 *     AND getSessionAal() returns 'aal1' AND MFA_CHALLENGE_READY=false
 *       → redirect('/login/mfa-pending?next=...').
 *   - When required ∈ {'manager','owner'} AND profile rank ≥ required
 *     AND getSessionAal() returns 'aal1' AND MFA_CHALLENGE_READY=true
 *       → redirect('/login/mfa-challenge?next=...').
 *   - When required ∈ {'member','cashier'} (any aal)
 *       → AAL not checked; returns { profile }.
 *   - Pre-existing redirects + throws keep their semantics — the AAL
 *     check runs AFTER the rank check, so a privilege escalation
 *     attempt by a lower-rank actor still throws InsufficientRoleError
 *     (never gets a "soft" mfa-pending redirect).
 *
 * Mocking strategy mirrors `requireRole.test.ts`:
 *   - vi.mock('server-only')
 *   - vi.mock('next/navigation', { redirect })
 *   - vi.mock('next/headers', { headers })
 *   - vi.mock('./getCurrentProfile') AND '@/lib/auth/getCurrentProfile'
 *   - vi.mock('./getSessionAal')     AND '@/lib/auth/getSessionAal'
 *   - vi.mock('./mfa-availability')  AND '@/lib/auth/mfa-availability'
 *     — using `MFA_CHALLENGE_READY` as a mutable mock so we can flip
 *     it between cases in this file without resetting modules.
 *
 * Why the dual relative + aliased mocks: the SUT imports via relative
 * paths (`./getCurrentProfile`, `./getSessionAal`, `./mfa-availability`),
 * and vitest hashes module mocks by resolved path. Mirroring both
 * paths keeps the mock active regardless of which import form the SUT
 * (or a future refactor) uses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    getCurrentProfile: vi.fn(),
    getSessionAal: vi.fn<() => Promise<'aal1' | 'aal2'>>(),
    redirect: vi.fn((target: string) => {
      const err = new Error(`NEXT_REDIRECT: ${target}`);
      err.name = 'RedirectError';
      (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;${target}`;
      throw err;
    }),
    headersGet: vi.fn<(name: string) => string | null>(),
    // Mutable feature constant — `vi.doMock` style won't work here
    // because the SUT imports the constant at module load. We use a
    // getter so the test can flip the value at runtime.
    mfaState: { ready: false as boolean },
  };
});

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

vi.mock('next/headers', () => ({
  headers: async () => ({ get: mocks.headersGet }),
}));

vi.mock('./getCurrentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));
vi.mock('@/lib/auth/getCurrentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

vi.mock('./getSessionAal', () => ({
  getSessionAal: mocks.getSessionAal,
}));
vi.mock('@/lib/auth/getSessionAal', () => ({
  getSessionAal: mocks.getSessionAal,
}));

// Mock the constant via a getter so test cases can toggle it. The SUT
// reads `MFA_CHALLENGE_READY` once per call (not at module load), so a
// getter that returns the current `mocks.mfaState.ready` value works.
vi.mock('./mfa-availability', () => ({
  get MFA_CHALLENGE_READY() {
    return mocks.mfaState.ready;
  },
}));
vi.mock('@/lib/auth/mfa-availability', () => ({
  get MFA_CHALLENGE_READY() {
    return mocks.mfaState.ready;
  },
}));

// Imports AFTER vi.mock so the SUT picks up the mocked modules.
import { requireRole, type Role } from '@/lib/auth/requireRole';
import { InsufficientRoleError } from '@/lib/auth/errors';

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

const setHeaders = (entries: Record<string, string>) => {
  mocks.headersGet.mockImplementation((name: string) => entries[name] ?? null);
};

beforeEach(() => {
  mocks.redirect.mockClear();
  mocks.getCurrentProfile.mockReset();
  mocks.getSessionAal.mockReset();
  mocks.headersGet.mockReset();
  mocks.headersGet.mockImplementation(() => null);
  // Default: MFA route is NOT ready (matches prod constant + ADR-0035
  // Open Q 7 fallback). Cases that need MFA_CHALLENGE_READY=true flip
  // this explicitly.
  mocks.mfaState.ready = false;
});

describe('requireRole AAL gate — passes when aal2 for manager+ required', () => {
  it('manager profile + required=manager + aal2 → returns profile, no redirect', async () => {
    const profile = makeProfile('manager');
    mocks.getCurrentProfile.mockResolvedValueOnce(profile);
    mocks.getSessionAal.mockResolvedValueOnce('aal2');

    const result = await requireRole('manager');

    expect(result).toEqual({ profile });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getSessionAal).toHaveBeenCalledTimes(1);
  });

  it('owner profile + required=owner + aal2 → returns profile, no redirect', async () => {
    const profile = makeProfile('owner');
    mocks.getCurrentProfile.mockResolvedValueOnce(profile);
    mocks.getSessionAal.mockResolvedValueOnce('aal2');

    const result = await requireRole('owner');

    expect(result).toEqual({ profile });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('owner profile + required=manager + aal2 → returns profile (over-privileged still passes AAL)', async () => {
    const profile = makeProfile('owner');
    mocks.getCurrentProfile.mockResolvedValueOnce(profile);
    mocks.getSessionAal.mockResolvedValueOnce('aal2');

    const result = await requireRole('manager');
    expect(result).toEqual({ profile });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('requireRole AAL gate — redirects to /login/mfa-pending when aal1 + MFA_CHALLENGE_READY=false', () => {
  it('manager profile + required=manager + aal1 + MFA_CHALLENGE_READY=false → redirect /login/mfa-pending?next=...', async () => {
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('manager'));
    mocks.getSessionAal.mockResolvedValueOnce('aal1');
    setHeaders({ 'x-pathname': '/admin' });
    mocks.mfaState.ready = false;

    await expect(requireRole('manager')).rejects.toMatchObject({ name: 'RedirectError' });

    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    const target = mocks.redirect.mock.calls[0]![0] as string;
    expect(target).toBe('/login/mfa-pending?next=%2Fadmin');
  });

  it('owner profile + required=manager + aal1 + MFA_CHALLENGE_READY=false → redirect /login/mfa-pending', async () => {
    expect.assertions(2);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('owner'));
    mocks.getSessionAal.mockResolvedValueOnce('aal1');
    setHeaders({ 'x-pathname': '/admin/members' });
    mocks.mfaState.ready = false;

    await expect(requireRole('manager')).rejects.toMatchObject({ name: 'RedirectError' });

    const target = mocks.redirect.mock.calls[0]![0] as string;
    expect(target).toBe('/login/mfa-pending?next=%2Fadmin%2Fmembers');
  });

  it('owner profile + required=owner + aal1 → redirect /login/mfa-pending', async () => {
    expect.assertions(2);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('owner'));
    mocks.getSessionAal.mockResolvedValueOnce('aal1');
    setHeaders({ 'x-pathname': '/admin/flags' });
    mocks.mfaState.ready = false;

    await expect(requireRole('owner')).rejects.toMatchObject({ name: 'RedirectError' });

    const target = mocks.redirect.mock.calls[0]![0] as string;
    expect(target).toBe('/login/mfa-pending?next=%2Fadmin%2Fflags');
  });

  it('encodes pathname AND search into the next param on the AAL redirect', async () => {
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('manager'));
    mocks.getSessionAal.mockResolvedValueOnce('aal1');
    setHeaders({ 'x-pathname': '/admin/audit-log', 'x-search': '?action=admin.session.entered' });
    mocks.mfaState.ready = false;

    await expect(requireRole('manager')).rejects.toMatchObject({ name: 'RedirectError' });

    const target = mocks.redirect.mock.calls[0]![0] as string;
    expect(target).toContain('/login/mfa-pending?next=');
    // %3F = "?", %3D = "=", %2E = "."
    expect(target).toContain('%2Fadmin%2Faudit-log');
  });
});

describe('requireRole AAL gate — redirects to /login/mfa-challenge when aal1 + MFA_CHALLENGE_READY=true', () => {
  it('manager + aal1 + MFA_CHALLENGE_READY=true → redirect /login/mfa-challenge?next=...', async () => {
    expect.assertions(2);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('manager'));
    mocks.getSessionAal.mockResolvedValueOnce('aal1');
    setHeaders({ 'x-pathname': '/admin' });
    mocks.mfaState.ready = true;

    await expect(requireRole('manager')).rejects.toMatchObject({ name: 'RedirectError' });

    const target = mocks.redirect.mock.calls[0]![0] as string;
    expect(target).toBe('/login/mfa-challenge?next=%2Fadmin');
  });
});

describe('requireRole AAL gate — NOT checked for member|cashier required minimums', () => {
  it('member profile + required=member + aal1 → returns profile, getSessionAal NOT called', async () => {
    const profile = makeProfile('member');
    mocks.getCurrentProfile.mockResolvedValueOnce(profile);
    // Even if AAL would resolve to aal1, the gate must not fire.
    mocks.getSessionAal.mockResolvedValueOnce('aal1');

    const result = await requireRole('member');

    expect(result).toEqual({ profile });
    expect(mocks.redirect).not.toHaveBeenCalled();
    // The critical assertion: AAL was never consulted because required
    // is below the manager+ threshold. This is the "no behavior change
    // for member/cashier callers" invariant from t2.
    expect(mocks.getSessionAal).not.toHaveBeenCalled();
  });

  it('cashier profile + required=cashier + aal1 → returns profile, getSessionAal NOT called', async () => {
    const profile = makeProfile('cashier');
    mocks.getCurrentProfile.mockResolvedValueOnce(profile);
    mocks.getSessionAal.mockResolvedValueOnce('aal1');

    const result = await requireRole('cashier');

    expect(result).toEqual({ profile });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getSessionAal).not.toHaveBeenCalled();
  });

  it('manager profile + required=cashier + aal1 → returns profile, AAL not checked (required is below threshold)', async () => {
    // A higher-rank actor calling a lower-rank gate should not trigger
    // the AAL check — the gate's REQUIRED rank decides, not the
    // ACTOR's rank. This is load-bearing: the member portal must keep
    // working for manager+ users without an aal2 session.
    const profile = makeProfile('manager');
    mocks.getCurrentProfile.mockResolvedValueOnce(profile);
    mocks.getSessionAal.mockResolvedValueOnce('aal1');

    const result = await requireRole('cashier');

    expect(result).toEqual({ profile });
    expect(mocks.getSessionAal).not.toHaveBeenCalled();
  });
});

describe('requireRole AAL gate — unchanged branches still take precedence', () => {
  it('no profile + required=manager → redirects to /login (not /login/mfa-pending), AAL not checked', async () => {
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce(null);
    setHeaders({ 'x-pathname': '/admin' });

    await expect(requireRole('manager')).rejects.toMatchObject({ name: 'RedirectError' });

    const target = mocks.redirect.mock.calls[0]![0] as string;
    // Critical: the no-session branch redirects to /login, NOT to
    // /login/mfa-pending. Collapsing these two would deceive the user
    // about WHY they're being blocked (no session vs. session without
    // MFA). Premortem invariant: never collapse the two branches.
    expect(target).toBe('/login?next=%2Fadmin');
    expect(mocks.getSessionAal).not.toHaveBeenCalled();
  });

  it('member profile + required=owner → throws InsufficientRoleError, AAL not checked', async () => {
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
    // Critical: a privilege-escalation attempt MUST surface as
    // InsufficientRoleError — never as a deceptive mfa-pending redirect.
    // The AAL check runs AFTER the rank check, so getSessionAal is
    // never consulted on this path.
    expect(mocks.getSessionAal).not.toHaveBeenCalled();
  });

  it('cashier profile + required=manager → throws InsufficientRoleError (not AAL redirect)', async () => {
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('cashier'));

    let caught: unknown;
    try {
      await requireRole('manager');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(InsufficientRoleError);
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getSessionAal).not.toHaveBeenCalled();
  });
});
