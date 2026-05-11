/**
 * Unit tests for `app/(member)/layout.tsx` plus static-source invariants
 * across the cycle-3 (member) surface (ADR-0002 cycle 3, t6).
 *
 * Run locally:    pnpm test tests/auth/member-layout.test.ts
 * Prerequisites:  none — pure module mocks + readFileSync source assertions.
 *
 * Spec: docs/specs/0002-authentication-implementation.md AC8 (member layout +
 *       dashboard + profile stubs).
 *
 * SUT contract (per AC8 + t6 dispatch):
 *   - `app/(member)/layout.tsx` is a server component. Calls
 *     `getCurrentProfile()`. If null → `redirect('/login')` (no `?next=`
 *     here — middleware AC10 already encoded the original path; the
 *     layout fires only on bypass and doesn't know the original URL).
 *   - On profile present, renders a minimal shell wrapping `{children}`.
 *   - The dashboard's logout control MUST be a `<form method="post"
 *     action="/logout">` — never an `<a href="/logout">` (CSRF defense
 *     pinned by AC5; logout is POST-only).
 *   - The profile page renders `profile.email` + `profile.role`.
 *   - The whole surface is server-component-only — no `'use client'`
 *     boundaries this cycle (AC8 invariant; cycle 3 stays RSC).
 *
 * Mocking strategy mirrors tests/auth/middleware.test.ts: `vi.hoisted` to
 * declare mock fns at the hoist phase so the `vi.mock` factories below can
 * reference them without ReferenceError. The mocked `redirect` throws a
 * sentinel error with `digest` matching Next.js's `NEXT_REDIRECT;<target>`
 * shape so the test can assert both that a redirect was called AND that the
 * SUT bailed out instead of returning a tree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Hoisted mocks. Declared inside vi.hoisted so the factories that reference
// them run at the same phase as the factories themselves. The redirect mock
// throws a Next.js-shaped sentinel — real `redirect()` does the same internally
// so the SUT short-circuits on the no-profile path; we mirror that contract.
const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  redirect: vi.fn((p: string) => {
    const e = new Error(`NEXT_REDIRECT: ${p}`);
    (e as unknown as { digest: string }).digest = `NEXT_REDIRECT;${p}`;
    throw e;
  }),
  headersGet: vi.fn<(name: string) => string | null>(),
}));

// Neutralize the `import 'server-only'` directive at the top of the
// getCurrentProfile module-graph so importing it under vitest does not
// throw. Same trick as tests/auth/getCurrentProfile.test.ts.
vi.mock('server-only', () => ({}));

vi.mock('@/lib/auth/getCurrentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

// next/headers is mocked async to mirror the requireRole.test.ts pattern —
// the SUT awaits headers() for Next-15 forward-compat even though Next 14
// returns synchronously.
vi.mock('next/headers', () => ({
  headers: async () => ({ get: mocks.headersGet }),
}));

// Import AFTER vi.mock so the SUT picks up the mocked dependencies.
// eslint-disable-next-line import/first
import MemberLayout from '@/app/(member)/layout';

// Repo-root absolute paths for source-text assertions. Derived from
// import.meta.url (vitest sets this to the test file location). Going two
// directories up lands at the repo root regardless of the test runner's cwd.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LAYOUT_PATH = path.join(REPO_ROOT, 'app', '(member)', 'layout.tsx');
const DASHBOARD_PATH = path.join(REPO_ROOT, 'app', '(member)', 'dashboard', 'page.tsx');
const PROFILE_PATH = path.join(REPO_ROOT, 'app', '(member)', 'profile', 'page.tsx');

const MEMBER_SURFACE_FILES = [LAYOUT_PATH, DASHBOARD_PATH, PROFILE_PATH];

beforeEach(() => {
  mocks.getCurrentProfile.mockReset();
  mocks.redirect.mockClear();
  // Re-install the throw-on-call behavior on redirect: mockClear preserves
  // the implementation, but mockReset (used elsewhere) would wipe it. We use
  // mockClear here intentionally so the hoisted implementation survives.
  mocks.headersGet.mockReset();
  // Default: no headers set — the SUT falls back to /dashboard.
  mocks.headersGet.mockImplementation(() => null);
});

describe('member layout', () => {
  it('redirects to /login?next=<x-pathname> when getCurrentProfile returns null', async () => {
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce(null);
    // Middleware (AC10) sets `x-pathname` on the forwarded request; the
    // layout reads it via next/headers and echoes it as `?next=`.
    mocks.headersGet.mockImplementation((name: string) =>
      name === 'x-pathname' ? '/profile' : null,
    );

    await expect(MemberLayout({ children: 'kids' })).rejects.toThrow(
      /NEXT_REDIRECT: \/login\?next=/,
    );

    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    // %2F = /. The encoded `next` MUST decode back to `/profile`.
    expect(mocks.redirect).toHaveBeenCalledWith('/login?next=%2Fprofile');
  });

  it('preserves x-search alongside x-pathname when both headers are set', async () => {
    expect.assertions(2);
    mocks.getCurrentProfile.mockResolvedValueOnce(null);
    mocks.headersGet.mockImplementation((name: string) => {
      if (name === 'x-pathname') return '/admin/users';
      if (name === 'x-search') return '?page=2';
      return null;
    });

    await expect(MemberLayout({ children: 'kids' })).rejects.toThrow(/NEXT_REDIRECT/);

    const target = mocks.redirect.mock.calls[0]![0] as string;
    // The search string is concatenated then encoded: ?page=2 → %3Fpage%3D2.
    expect(target).toBe('/login?next=%2Fadmin%2Fusers%3Fpage%3D2');
  });

  it('falls back to /dashboard when x-pathname is absent (header bypass)', async () => {
    // If the layout fires without middleware running first (e.g. an
    // internal RSC navigation), there is no x-pathname header. The
    // contract is to fall back to /dashboard rather than crashing or
    // redirecting to a nonsense path.
    expect.assertions(2);
    mocks.getCurrentProfile.mockResolvedValueOnce(null);
    mocks.headersGet.mockImplementation(() => null);

    await expect(MemberLayout({ children: 'kids' })).rejects.toThrow(/NEXT_REDIRECT/);

    const target = mocks.redirect.mock.calls[0]![0] as string;
    expect(target).toBe('/login?next=%2Fdashboard');
  });

  it('renders children when profile is present', async () => {
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce({
      id: 'uuid-a',
      full_name: 'Alice',
      email: 'a@x.com',
      role: 'member',
    });

    // No throw expected. The layout returns a JSX element wrapping `children`.
    const result = await MemberLayout({ children: 'kids' });

    // The wrapper element's children prop equals the children we passed.
    // We don't pin the wrapper tag/className — those are styling churn.
    // What matters is that the children prop survives the wrap.
    expect(result).toBeTruthy();
    // result is a React element: { type, props: { children, ... }, ... }.
    // Using a loose type assertion because the SUT's return type is
    // `Promise<JSX.Element>` and we want to inspect the props bag at runtime.
    const element = result as unknown as { props: { children: unknown } };
    expect(element.props.children).toBe('kids');

    // And critically: redirect was NOT called on the happy path.
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('calls getCurrentProfile exactly once per layout invocation', async () => {
    expect.assertions(1);
    mocks.getCurrentProfile.mockResolvedValueOnce({
      id: 'uuid-b',
      full_name: 'Bob',
      email: 'b@x.com',
      role: 'member',
    });

    await MemberLayout({ children: 'whatever' });

    // The layout itself MUST call getCurrentProfile exactly once. The
    // dashboard and profile page each ALSO call it, but React.cache (per
    // AC6) dedupes within a single render — that dedup is exercised in
    // tests/auth/getCurrentProfile.test.ts. This test pins only the layout
    // call count.
    expect(mocks.getCurrentProfile.mock.calls.length).toBe(1);
  });
});

describe('member surface source invariants', () => {
  // These are static-source assertions, not runtime tests. They pin
  // load-bearing code shapes that runtime tests would either miss
  // (e.g., the absence of an `<a href="/logout">` link) or that depend
  // on Next.js internals we'd rather not stub (e.g., RSC pre-render).
  //
  // Read once per test — the files are tiny stubs (sub-1KB each).

  it('layout source calls redirect with /login?next= and reads x-pathname', () => {
    // Per AC8: "If `null`, throws `redirect('/login?next=<currentPath>')`
    // using the same `x-pathname` middleware handshake." Pin both halves
    // structurally so a future refactor that drops either side trips this
    // assertion.
    const src = readFileSync(LAYOUT_PATH, 'utf8');
    expect(src).toContain('/login?next=');
    expect(src).toContain('x-pathname');
  });

  it('layout source imports getCurrentProfile from @/lib/auth/getCurrentProfile', () => {
    const src = readFileSync(LAYOUT_PATH, 'utf8');
    // Tolerate single OR double quotes around the module specifier — both
    // are valid TS. Using a regex with character class.
    expect(src).toMatch(
      /import\s*\{\s*getCurrentProfile\s*\}\s*from\s*['"]@\/lib\/auth\/getCurrentProfile['"]/,
    );
  });

  it("layout source does NOT contain 'use client'", () => {
    const src = readFileSync(LAYOUT_PATH, 'utf8');
    // The layout MUST be a server component (AC8). The literal directive
    // is what Next.js uses to mark a client boundary; assert it's absent.
    expect(src).not.toContain("'use client'");
    // Belt-and-suspenders: also reject the double-quoted form.
    expect(src).not.toContain('"use client"');
  });

  it('dashboard source uses <form method="post" action="/logout">', () => {
    const src = readFileSync(DASHBOARD_PATH, 'utf8');
    // Loose check: the same opening <form ...> tag must contain BOTH
    // method="post" AND action="/logout". We don't pin attribute order.
    expect(src).toMatch(/<form[^>]*method="post"[^>]*action="\/logout"[^>]*>/);
    // AND the inverse order, in case a future edit flips the attribute order.
    // Combined into a single OR check via a more permissive multiline regex:
    const hasFormPostLogout =
      /<form[^>]*method="post"[^>]*action="\/logout"[^>]*>/.test(src) ||
      /<form[^>]*action="\/logout"[^>]*method="post"[^>]*>/.test(src);
    expect(hasFormPostLogout).toBe(true);
  });

  it('dashboard source does NOT contain an <a href="/logout"> link (CSRF)', () => {
    const src = readFileSync(DASHBOARD_PATH, 'utf8');
    // CSRF defense: logout MUST be POST. A GET-able <a href="/logout">
    // would let any third-party origin trigger logout via image/link
    // prefetch. We reject any anchor whose href is exactly "/logout"
    // (single OR double quoted). We allow anchors to OTHER URLs that
    // happen to mention logout (e.g., /logout-help — none today, but
    // future-proof) by anchoring the regex to the closing quote.
    expect(src).not.toMatch(/<a\s[^>]*href="\/logout"/);
    expect(src).not.toMatch(/<a\s[^>]*href='\/logout'/);
  });

  it('profile source contains profile.email and profile.role', () => {
    const src = readFileSync(PROFILE_PATH, 'utf8');
    expect(src).toContain('profile.email');
    expect(src).toContain('profile.role');
  });

  it("no file in the (member) surface contains 'use client'", () => {
    // Iterate every file in the member surface — layout + both pages.
    // Keeps the AC8 server-component-only invariant from drifting if a
    // future edit touches the dashboard or profile page directly.
    for (const filePath of MEMBER_SURFACE_FILES) {
      const src = readFileSync(filePath, 'utf8');
      expect(
        src,
        `${path.relative(REPO_ROOT, filePath)} must not contain 'use client'`,
      ).not.toContain("'use client'");
      expect(
        src,
        `${path.relative(REPO_ROOT, filePath)} must not contain "use client"`,
      ).not.toContain('"use client"');
    }
  });
});
