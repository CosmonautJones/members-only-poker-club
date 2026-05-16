/**
 * Unit tests for `app/(admin)/admin/layout.tsx` plus static-source
 * invariants across the admin role-gate (ADR-0035 AC4, WA.T3).
 *
 * Run locally:    pnpm test tests/auth/admin-routes.test.ts
 * Prerequisites:  none — pure module mocks + readFileSync source assertions.
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC4
 *       (admin layout role-gate + first-body-statement invariant +
 *       AAL check encapsulated inside requireRole, NOT inside layout).
 *
 * SUT contract (per AC4):
 *   - The layout is a server component. Its FIRST body statement (after
 *     parameter destructuring) is `const { profile } = await requireRole('manager');`
 *   - `requireRole` encapsulates:
 *       • no profile → redirect('/login?next=<encoded path>')
 *       • rank < manager → throw InsufficientRoleError (boundary → 403)
 *       • manager+ with aal1 + MFA_CHALLENGE_READY=true → redirect to
 *         /login/mfa-challenge?next=...
 *       • manager+ with aal1 + MFA_CHALLENGE_READY=false → redirect to
 *         /login/mfa-pending?next=...
 *       • manager+ with aal2 → returns { profile }
 *   - The string `aal` MUST NOT appear in `layout.tsx` — the AAL check
 *     lives inside `lib/auth/requireRole.ts`, NOT inside the layout
 *     (B1 reconciliation per AC4 + planner's premortem invariant).
 *
 * Mocking strategy mirrors `tests/auth/requireRole-aal.test.ts`:
 *   - vi.mock('server-only')
 *   - vi.mock('next/navigation', { redirect })
 *   - vi.mock('next/headers', { headers })
 *   - vi.mock('./getCurrentProfile') AND '@/lib/auth/getCurrentProfile'
 *   - vi.mock('./getSessionAal')     AND '@/lib/auth/getSessionAal'
 *   - vi.mock('./mfa-availability')  AND '@/lib/auth/mfa-availability'
 *     with a getter so MFA_CHALLENGE_READY flips between cases.
 *
 * Note: we exercise the REAL `requireRole` against mocked dependencies
 * (getCurrentProfile, getSessionAal, headers, redirect) — this gives us
 * end-to-end coverage of the layout → requireRole pipeline without
 * stubbing the gate itself. The pre-existing
 * `tests/auth/requireRole-aal.test.ts` tests the gate's branches in
 * isolation; this file tests the layout's first-statement consumption
 * of those branches.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Hoisted mocks. Declared inside vi.hoisted so the factories below can
// reference them at the same phase. The redirect mock throws a
// Next.js-shaped sentinel (matching the real `redirect()` short-circuit).
const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  getSessionAal: vi.fn<() => Promise<'aal1' | 'aal2'>>(),
  redirect: vi.fn((p: string) => {
    const e = new Error(`NEXT_REDIRECT: ${p}`);
    e.name = 'RedirectError';
    (e as Error & { digest?: string }).digest = `NEXT_REDIRECT;${p}`;
    throw e;
  }),
  headersGet: vi.fn<(name: string) => string | null>(),
  // Mutable feature constant — toggled per-case via getter-backed mock.
  // Default mirrors prod (MFA_CHALLENGE_READY = false) per
  // lib/auth/mfa-availability.ts.
  mfaState: { ready: false as boolean },
}));

// Neutralize `server-only` so importing the layout under vitest does
// not throw. Same trick as tests/auth/member-layout.test.ts.
vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

// next/headers mocked async to mirror the Next-15 forward-compat
// pattern used in requireRole.ts. `cookies()` is consumed by the admin
// layout's PostHog `admin_session_entered` dedup (t17 / t18) — the
// returned store needs `.get(name)` and `.set(name, value)` shims even
// though this test suite never asserts on either: the layout reads the
// dedup cookie before the test-supplied requireRole mock would short-
// circuit, so an absent shim throws at the cookies() call site.
vi.mock('next/headers', () => ({
  headers: async () => ({ get: mocks.headersGet }),
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
  }),
}));

vi.mock('@/lib/auth/getCurrentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));
// requireRole.ts imports `./getCurrentProfile` (relative) — mirror so
// vitest's module-id hashing matches that import form too.
vi.mock('../../lib/auth/getCurrentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

vi.mock('@/lib/auth/getSessionAal', () => ({
  getSessionAal: mocks.getSessionAal,
}));
vi.mock('../../lib/auth/getSessionAal', () => ({
  getSessionAal: mocks.getSessionAal,
}));

// Mock the MFA constant via a getter so test cases can flip the value.
// The SUT (requireRole) reads `MFA_CHALLENGE_READY` once per call (via
// `MfaAvailability.MFA_CHALLENGE_READY`), so the getter resolves to the
// current `mocks.mfaState.ready` value at call time.
vi.mock('@/lib/auth/mfa-availability', () => ({
  get MFA_CHALLENGE_READY() {
    return mocks.mfaState.ready;
  },
}));
vi.mock('../../lib/auth/mfa-availability', () => ({
  get MFA_CHALLENGE_READY() {
    return mocks.mfaState.ready;
  },
}));

// Imports AFTER vi.mock so the SUT picks up the mocked dependencies.
// eslint-disable-next-line import/first
import AdminLayout from '@/app/(admin)/admin/layout';
// eslint-disable-next-line import/first
import { InsufficientRoleError } from '@/lib/auth/errors';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ADMIN_LAYOUT_PATH = path.join(REPO_ROOT, 'app', '(admin)', 'admin', 'layout.tsx');
const REQUIRE_ROLE_PATH = path.join(REPO_ROOT, 'lib', 'auth', 'requireRole.ts');

type Role = 'member' | 'cashier' | 'manager' | 'owner';

type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
};

const makeProfile = (role: Role, overrides: Partial<Profile> = {}): Profile => ({
  id: 'uuid-admin-test',
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
  // Open Q 7 fallback). Cases that flip the value do so explicitly.
  mocks.mfaState.ready = false;
});

describe('admin layout — unauthenticated session', () => {
  it('redirects to /login?next=/admin when no profile and pathname is /admin', async () => {
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce(null);
    setHeaders({ 'x-pathname': '/admin' });

    await expect(AdminLayout({ children: 'kids' })).rejects.toMatchObject({
      name: 'RedirectError',
    });

    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledWith('/login?next=%2Fadmin');
  });

  it('preserves x-search alongside x-pathname on the unauth redirect', async () => {
    expect.assertions(2);
    mocks.getCurrentProfile.mockResolvedValueOnce(null);
    setHeaders({ 'x-pathname': '/admin/audit-log', 'x-search': '?page=2' });

    await expect(AdminLayout({ children: 'kids' })).rejects.toMatchObject({
      name: 'RedirectError',
    });

    const target = mocks.redirect.mock.calls[0]![0] as string;
    // %3F = "?", %3D = "=". The search string is concatenated to the
    // pathname then encoded whole.
    expect(target).toBe('/login?next=%2Fadmin%2Faudit-log%3Fpage%3D2');
  });
});

describe('admin layout — insufficient role throws InsufficientRoleError', () => {
  it('member-roled session → throws InsufficientRoleError (boundary → 403)', async () => {
    expect.assertions(4);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('member'));
    setHeaders({ 'x-pathname': '/admin' });

    let caught: unknown;
    try {
      await AdminLayout({ children: 'kids' });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(InsufficientRoleError);
    const err = caught as InsufficientRoleError;
    expect(err.required).toBe('manager');
    expect(err.actual).toBe('member');
    // Critically: redirect was NOT called on the role-throw path —
    // never collapse the rank-deny and AAL-deny branches.
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('cashier-roled session → throws InsufficientRoleError', async () => {
    expect.assertions(4);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('cashier'));
    setHeaders({ 'x-pathname': '/admin' });

    let caught: unknown;
    try {
      await AdminLayout({ children: 'kids' });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(InsufficientRoleError);
    const err = caught as InsufficientRoleError;
    expect(err.required).toBe('manager');
    expect(err.actual).toBe('cashier');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('admin layout — manager/owner with aal2 → renders children', () => {
  it('manager + aal2 → returns rendered shell wrapping children, no redirect', async () => {
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('manager'));
    mocks.getSessionAal.mockResolvedValueOnce('aal2');

    const result = await AdminLayout({ children: 'kids' });

    expect(result).toBeTruthy();
    // The children survive the wrap somewhere in the rendered tree.
    // We do NOT pin the exact wrapper tag — the shell may grow
    // (e.g. an outer pane, future banners) without breaking this test.
    const containsKids = (node: unknown): boolean => {
      if (node === 'kids') return true;
      if (Array.isArray(node)) return node.some(containsKids);
      if (node && typeof node === 'object' && 'props' in node) {
        const props = (node as { props?: { children?: unknown } }).props;
        if (props && 'children' in props) return containsKids(props.children);
      }
      return false;
    };
    expect(containsKids(result)).toBe(true);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('owner + aal2 → returns rendered shell wrapping children, no redirect', async () => {
    expect.assertions(2);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('owner'));
    mocks.getSessionAal.mockResolvedValueOnce('aal2');

    const result = await AdminLayout({ children: 'kids' });

    expect(result).toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('admin layout — aal1 manager+ redirects to MFA route', () => {
  it('manager + aal1 + MFA_CHALLENGE_READY=true → redirect /login/mfa-challenge?next=/admin', async () => {
    expect.assertions(2);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('manager'));
    mocks.getSessionAal.mockResolvedValueOnce('aal1');
    setHeaders({ 'x-pathname': '/admin' });
    mocks.mfaState.ready = true;

    await expect(AdminLayout({ children: 'kids' })).rejects.toMatchObject({
      name: 'RedirectError',
    });

    const target = mocks.redirect.mock.calls[0]![0] as string;
    expect(target).toBe('/login/mfa-challenge?next=%2Fadmin');
  });

  it('manager + aal1 + MFA_CHALLENGE_READY=false → redirect /login/mfa-pending?next=/admin', async () => {
    expect.assertions(2);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('manager'));
    mocks.getSessionAal.mockResolvedValueOnce('aal1');
    setHeaders({ 'x-pathname': '/admin' });
    mocks.mfaState.ready = false;

    await expect(AdminLayout({ children: 'kids' })).rejects.toMatchObject({
      name: 'RedirectError',
    });

    const target = mocks.redirect.mock.calls[0]![0] as string;
    // Critical: when MFA_CHALLENGE_READY=false, the fallback page is
    // /login/mfa-pending (graceful degradation per ADR-0035 Open Q 7
    // + premortem R13). Never /login/mfa-challenge.
    expect(target).toBe('/login/mfa-pending?next=%2Fadmin');
  });

  it('owner + aal1 + MFA_CHALLENGE_READY=false → redirect /login/mfa-pending', async () => {
    expect.assertions(2);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('owner'));
    mocks.getSessionAal.mockResolvedValueOnce('aal1');
    setHeaders({ 'x-pathname': '/admin/flags' });
    mocks.mfaState.ready = false;

    await expect(AdminLayout({ children: 'kids' })).rejects.toMatchObject({
      name: 'RedirectError',
    });

    const target = mocks.redirect.mock.calls[0]![0] as string;
    expect(target).toBe('/login/mfa-pending?next=%2Fadmin%2Fflags');
  });
});

describe('admin layout source invariants (AC4)', () => {
  // Static-source assertions. These pin load-bearing code shapes that
  // runtime tests would either miss (e.g., the absence of an `aal`
  // string in the layout) or that depend on Next.js internals we'd
  // rather not stub.

  it("first body statement of the default-exported async function is `await requireRole('manager')`", () => {
    // Pin AC4-26: "first body statement IS `await requireRole('manager')`".
    // The walker is robust to comments, blank lines, and parameter
    // destructuring. We scan from the `export default async function`
    // header forward, skip any whitespace / comments / opening brace,
    // and assert the next non-trivial token starts with `const {`
    // (the destructuring of the returned `{ profile }`) followed by
    // `await requireRole('manager')`. Tolerate single OR double quotes.
    const src = readFileSync(ADMIN_LAYOUT_PATH, 'utf8');

    // Find the default-exported async function. The layout exports as
    // `export default async function AdminLayout(...) { ... }`.
    const exportMatch = src.match(
      /export\s+default\s+async\s+function\s+\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/,
    );
    expect(exportMatch).toBeTruthy();
    const bodyStart = exportMatch!.index! + exportMatch![0].length;
    // Walk forward to the first non-whitespace / non-comment token.
    let i = bodyStart;
    const advancePastTrivia = (): void => {
      while (i < src.length) {
        // Whitespace.
        if (/\s/.test(src[i]!)) {
          i += 1;
          continue;
        }
        // Line comment.
        if (src.slice(i, i + 2) === '//') {
          const eol = src.indexOf('\n', i);
          i = eol === -1 ? src.length : eol + 1;
          continue;
        }
        // Block comment.
        if (src.slice(i, i + 2) === '/*') {
          const end = src.indexOf('*/', i + 2);
          i = end === -1 ? src.length : end + 2;
          continue;
        }
        break;
      }
    };
    advancePastTrivia();

    const firstStmt = src.slice(i, i + 80);
    // The contract pinned by the spec phrases the first body statement
    // as "await requireRole('manager')" — accept either the bare
    // expression (`await requireRole('manager')`) or the destructuring
    // form (`const { profile } = await requireRole('manager')`).
    // The destructuring form is the canonical shape, matching the
    // existing pattern in lib/auth/requireRole.ts's return type.
    expect(firstStmt).toMatch(
      /^(?:const\s*\{\s*profile\s*\}\s*=\s*)?await\s+requireRole\(\s*['"]manager['"]\s*\)/,
    );
  });

  it('layout.tsx does NOT contain the string `aal` (AAL check lives in requireRole, not layout)', () => {
    // B1 reconciliation per AC4: the AAL assertion is encapsulated
    // INSIDE `lib/auth/requireRole.ts` so the admin layout has a
    // single first-statement (`await requireRole('manager')`). A
    // future refactor that pulls the AAL check up into the layout
    // would violate the "one gate, one first-statement" invariant
    // — pin it via source-grep.
    const src = readFileSync(ADMIN_LAYOUT_PATH, 'utf8');
    expect(src.toLowerCase()).not.toContain('aal');
  });

  it('lib/auth/requireRole.ts DOES reference the AAL gate (the check lives here)', () => {
    // Counterpart to the layout assertion above: the AAL check is
    // SUPPOSED to be in requireRole. If a future refactor accidentally
    // strips the gate, this test catches it.
    const src = readFileSync(REQUIRE_ROLE_PATH, 'utf8');
    // Case-insensitive — comments use "AAL2" / "aal2" interchangeably.
    expect(src.toLowerCase()).toMatch(/\baal\b/);
  });

  it("layout source does NOT contain 'use client' (server-component-only per AC4)", () => {
    const src = readFileSync(ADMIN_LAYOUT_PATH, 'utf8');
    expect(src).not.toContain("'use client'");
    expect(src).not.toContain('"use client"');
  });

  it('layout imports requireRole from @/lib/auth/requireRole', () => {
    const src = readFileSync(ADMIN_LAYOUT_PATH, 'utf8');
    expect(src).toMatch(
      /import\s*\{\s*requireRole\s*\}\s*from\s*['"]@\/lib\/auth\/requireRole['"]/,
    );
  });

  it('layout renders the six admin nav labels (Dashboard, Members, Verifications, Audit log, Flags, Privacy)', () => {
    // Pin AC4's verbatim nav list. Future slices may rearrange the
    // visual order or change the link styling, but the six labels
    // (and their hrefs) must remain.
    const src = readFileSync(ADMIN_LAYOUT_PATH, 'utf8');
    expect(src).toContain('Dashboard');
    expect(src).toContain('Members');
    expect(src).toContain('Verifications');
    expect(src).toContain('Audit log');
    expect(src).toContain('Flags');
    expect(src).toContain('Privacy');
    expect(src).toMatch(/\/admin\/members/);
    expect(src).toMatch(/\/admin\/verifications/);
    expect(src).toMatch(/\/admin\/audit-log/);
    expect(src).toMatch(/\/admin\/flags/);
    expect(src).toMatch(/\/admin\/privacy/);
  });
});
