/**
 * Unit tests for `app/(admin)/admin/page.tsx` — the AC7 admin dashboard
 * (ADR-0035 WA.T4).
 *
 * Run locally:    pnpm test tests/admin/dashboard-page.test.tsx
 * Prerequisites:  none — pure module mocks (no DB, no network).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC7
 *       (four cards + recent-activity panel + `unstable_cache` tag).
 *
 * SUT contract (per AC7):
 *   - Server component. FIRST body statement is
 *     `const { profile } = await requireRole('manager');`
 *   - Four cards with counts:
 *       • Pending verifications  → `/admin/verifications`
 *       • Pending deletion req.  → `/admin/privacy`
 *       • Active kill-switches   → `/admin/flags?prefix=kill-`
 *       • Recent activity        → `/admin/audit-log`
 *   - Recent activity panel renders the latest 5 `audit_log` rows with
 *     UTC + Central timestamps (ADR-0034).
 *   - Source-grep: file contains the literal `tags: ['admin-dashboard-counts']`
 *     so future refactors cannot silently drop the cache-invalidation seam.
 *
 * Mocking strategy mirrors `tests/auth/admin-routes.test.ts`:
 *   - vi.mock('server-only')
 *   - vi.mock('next/navigation', { redirect })
 *   - vi.mock('next/cache', { unstable_cache, revalidateTag })
 *     — unstable_cache becomes a pass-through so the underlying supabase
 *       chain mock is exercised on every call.
 *   - vi.mock('next/link') — happy-dom has no Next.js router context.
 *   - vi.mock('@/lib/auth/requireRole') — control the profile returned.
 *   - vi.mock('@/lib/supabase/server') — fluent-builder spy that
 *     responds to .from('profiles' | 'privacy_requests' | 'feature_flags' | 'audit_log').
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';

// ---- Hoisted mock primitives ----------------------------------------------

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn<
    (required: string) => Promise<{
      profile: { id: string; role: string; full_name: string; email: string };
    }>
  >(),
  // Each "table" responder returns a value-resolver for the supabase
  // fluent chain. The chain ends in either:
  //   - { count, error } for `.select(..., { count: 'exact', head: true })` builds,
  //   - { data, error }  for `.select(...).order(...).limit(...)` builds.
  // We model each chain as a thenable: the test sets the resolved value
  // ahead of time, and the SUT's `await` triggers it.
  tableResolvers: new Map<
    string,
    { count?: number | null; data?: unknown; error?: { message: string } | null }
  >(),
}));

// ---- Mocks ----------------------------------------------------------------

// `server-only` is a guard re-export. Neutralize so the SUT imports cleanly
// under vitest (mirrors the pattern in tests/auth/member-layout.test.ts).
vi.mock('server-only', () => ({}));

// `next/navigation` is imported transitively by requireRole. We mock
// redirect to a throw so any unintended call surfaces clearly. The test
// suite does not exercise redirect paths (those live in
// tests/auth/admin-routes.test.ts).
vi.mock('next/navigation', () => ({
  redirect: vi.fn((p: string) => {
    const e = new Error(`NEXT_REDIRECT: ${p}`);
    (e as Error & { digest?: string }).digest = `NEXT_REDIRECT;${p}`;
    throw e;
  }),
}));

// `unstable_cache` becomes a pass-through wrapper. Without this, the SUT
// would memoize the first response globally and our per-test
// reconfiguration of the supabase resolvers would not be seen by the
// SUT's cached closures.
//
// IMPORTANT: this mock is applied at module-evaluation time (hoisted), so
// every `unstable_cache(fn, key, opts)` call inside the SUT returns the
// raw `fn`. The `keyParts` and `options` are intentionally ignored — the
// `tags: ['admin-dashboard-counts']` literal is verified by source-grep
// further down the file.
vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(
    fn: T,
    _keyParts?: readonly unknown[],
    _options?: { revalidate?: number; tags?: readonly string[] },
  ): T => fn,
  revalidateTag: vi.fn(),
}));

// `next/link` resolves to a plain anchor under happy-dom. Forwarding
// `aria-label` is critical — the test asserts navigation via
// getByRole('link', { name: ... }).
vi.mock('next/link', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- match Next's permissive Link prop signature in tests
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// `requireRole` — we drive this directly rather than its dependency chain,
// because the role-gate is covered exhaustively by
// tests/auth/admin-routes.test.ts. This test only cares that the dashboard
// page calls it with `'manager'`.
vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: mocks.requireRole,
}));

// `lib/supabase/server` createClient — fluent-builder spy. The SUT issues
// these chains:
//   profiles:         .from('profiles')          .select(..count head).is(...).not(...)
//   privacy_requests: .from('privacy_requests')  .select(..count head).eq(...).eq(...)
//   feature_flags:    .from('feature_flags')     .select(..count head).like(...).eq(...)
//   audit_log:        .from('audit_log')         .select(...).order(...).limit(...)
//
// Each method returns the same chain object, which is itself awaitable
// (we attach a `then` resolver). When the chain is awaited, it resolves
// to the value the test pre-loaded into `mocks.tableResolvers`.
//
// This is the same pattern tests/admin code conventions favor — fluent
// chains without enforcing call order, so future SUT refactors that
// reorder filters keep passing.
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    function makeChain(table: string) {
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      // Every fluent method just returns the same chain.
      for (const m of [
        'select',
        'is',
        'not',
        'eq',
        'like',
        'order',
        'limit',
        'gt',
        'gte',
        'lt',
        'lte',
        'in',
        'or',
        'ilike',
        'filter',
        'range',
      ]) {
        chain[m] = passthrough;
      }
      // Promise-like: when awaited, resolve to the configured value.
      chain['then'] = (
        onFulfilled: (v: {
          count?: number | null;
          data?: unknown;
          error?: { message: string } | null;
        }) => unknown,
      ) => {
        const value = mocks.tableResolvers.get(table) ?? { count: 0, data: [], error: null };
        return Promise.resolve(value).then(onFulfilled);
      };
      return chain;
    }
    return {
      from: (table: string) => makeChain(table),
    };
  },
}));

// ---- Import AFTER vi.mock so the SUT picks up the stubs -------------------

// eslint-disable-next-line import/first
import AdminDashboardPage from '@/app/(admin)/admin/page';

// ---- Test helpers ---------------------------------------------------------

const PAGE_PATH = path.resolve(__dirname, '..', '..', 'app', '(admin)', 'admin', 'page.tsx');

const baseProfile = {
  id: 'uuid-test-manager',
  role: 'manager',
  full_name: 'Test Manager',
  email: 'manager@example.com',
};

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: baseProfile });
  mocks.tableResolvers.clear();
  // Sensible defaults so unconfigured queries don't blow up.
  mocks.tableResolvers.set('profiles', { count: 0, error: null });
  mocks.tableResolvers.set('privacy_requests', { count: 0, error: null });
  mocks.tableResolvers.set('feature_flags', { count: 0, error: null });
  mocks.tableResolvers.set('audit_log', { data: [], error: null });
});

async function renderPage(): Promise<void> {
  const tree = await AdminDashboardPage();
  render(tree as React.ReactElement);
}

// ---- Tests ----------------------------------------------------------------

describe('admin dashboard — requireRole gate', () => {
  it('calls requireRole("manager") as the first body statement', async () => {
    await renderPage();
    expect(mocks.requireRole).toHaveBeenCalledTimes(1);
    expect(mocks.requireRole).toHaveBeenCalledWith('manager');
  });

  it('propagates a thrown InsufficientRoleError from requireRole (does not swallow)', async () => {
    const err = new Error('InsufficientRoleError');
    err.name = 'InsufficientRoleError';
    mocks.requireRole.mockRejectedValueOnce(err);
    await expect(AdminDashboardPage()).rejects.toThrow(/InsufficientRoleError/);
  });
});

describe('admin dashboard — four cards render with their counts', () => {
  beforeEach(() => {
    mocks.tableResolvers.set('profiles', { count: 2, error: null });
    mocks.tableResolvers.set('privacy_requests', { count: 1, error: null });
    mocks.tableResolvers.set('feature_flags', { count: 0, error: null });
    mocks.tableResolvers.set('audit_log', {
      data: [
        {
          id: 5,
          action: 'admin.member.role_changed',
          target_type: 'profile',
          target_id: 'uuid-a',
          created_at: '2026-05-15T14:32:08.000Z',
        },
        {
          id: 4,
          action: 'admin.verification.approved',
          target_type: 'profile',
          target_id: 'uuid-b',
          created_at: '2026-05-15T13:18:01.000Z',
        },
        {
          id: 3,
          action: 'admin.privacy.export_approved',
          target_type: 'privacy_request',
          target_id: 'uuid-c',
          created_at: '2026-05-15T12:00:00.000Z',
        },
        {
          id: 2,
          action: 'profile.role_change',
          target_type: 'profile',
          target_id: 'uuid-d',
          created_at: '2026-05-15T09:45:30.000Z',
        },
        {
          id: 1,
          action: 'admin.flag.toggled',
          target_type: 'feature_flag',
          target_id: 'kill-payments',
          created_at: '2026-05-15T08:00:00.000Z',
        },
      ],
      error: null,
    });
  });

  it('renders the Pending verifications card with count 2', async () => {
    await renderPage();
    const card = screen.getByRole('link', { name: /pending verifications: 2/i });
    expect(card).toBeTruthy();
    expect(card.getAttribute('href')).toBe('/admin/verifications');
  });

  it('renders the Pending deletion requests card with count 1', async () => {
    await renderPage();
    const card = screen.getByRole('link', { name: /pending deletion requests: 1/i });
    expect(card).toBeTruthy();
    expect(card.getAttribute('href')).toBe('/admin/privacy');
  });

  it('renders the Active kill-switch flags card with count 0', async () => {
    await renderPage();
    const card = screen.getByRole('link', { name: /active kill-switch flags: 0/i });
    expect(card).toBeTruthy();
    expect(card.getAttribute('href')).toBe('/admin/flags?prefix=kill-');
  });

  it('renders the Recent activity card with count 5 linking to /admin/audit-log', async () => {
    await renderPage();
    const card = screen.getByRole('link', { name: /recent activity: 5/i });
    expect(card).toBeTruthy();
    expect(card.getAttribute('href')).toBe('/admin/audit-log');
  });
});

describe('admin dashboard — recent activity panel', () => {
  beforeEach(() => {
    mocks.tableResolvers.set('audit_log', {
      data: [
        {
          id: 5,
          action: 'admin.member.role_changed',
          target_type: 'profile',
          target_id: 'uuid-a',
          created_at: '2026-05-15T14:32:08.000Z',
        },
        {
          id: 4,
          action: 'admin.verification.approved',
          target_type: 'profile',
          target_id: 'uuid-b',
          created_at: '2026-05-15T13:18:01.000Z',
        },
        {
          id: 3,
          action: 'admin.privacy.export_approved',
          target_type: 'privacy_request',
          target_id: 'uuid-c',
          created_at: '2026-05-15T12:00:00.000Z',
        },
        {
          id: 2,
          action: 'profile.role_change',
          target_type: 'profile',
          target_id: 'uuid-d',
          created_at: '2026-05-15T09:45:30.000Z',
        },
        {
          id: 1,
          action: 'admin.flag.toggled',
          target_type: 'feature_flag',
          target_id: 'kill-payments',
          created_at: '2026-05-15T08:00:00.000Z',
        },
      ],
      error: null,
    });
  });

  it('renders all five action strings from the audit_log query', async () => {
    await renderPage();
    expect(screen.getByText('admin.member.role_changed')).toBeTruthy();
    expect(screen.getByText('admin.verification.approved')).toBeTruthy();
    expect(screen.getByText('admin.privacy.export_approved')).toBeTruthy();
    expect(screen.getByText('profile.role_change')).toBeTruthy();
    expect(screen.getByText('admin.flag.toggled')).toBeTruthy();
  });

  it('renders both a UTC and a Central timestamp for the most recent row', async () => {
    await renderPage();
    // The top row's iso is 2026-05-15T14:32:08.000Z → UTC literal contains
    // "14:32:08 UTC" and Central rendering contains "09:32:08" with either
    // CDT (May, daylight) or CST (winter) tz abbreviation. May is CDT.
    const utcMatch = screen.getByText(/14:32:08\s+UTC/);
    expect(utcMatch).toBeTruthy();
    const centralMatch = screen.getByText(/09:32:08\s+CDT/);
    expect(centralMatch).toBeTruthy();
  });

  it('renders an empty-state message when audit_log returns []', async () => {
    mocks.tableResolvers.set('audit_log', { data: [], error: null });
    await renderPage();
    expect(screen.getByText(/no audit activity yet/i)).toBeTruthy();
  });
});

describe('admin dashboard — source invariants (AC7 + AC35)', () => {
  it('contains the literal cache tag "admin-dashboard-counts" so revalidateTag(...) seams work', () => {
    // Pin AC35: the cache-invalidation contract requires the tag literal
    // to live on the page file. Mutation actions (t10-t17) invoke
    // `revalidateTag('admin-dashboard-counts')`; if a future refactor
    // strips the tag from the page, those invocations become no-ops and
    // the dashboard goes stale until the 30-second TTL expires.
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).toMatch(/tags:\s*\[\s*['"]admin-dashboard-counts['"]\s*\]/);
  });

  it('wraps fetchers in `unstable_cache` with `revalidate: 30`', () => {
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).toContain('unstable_cache');
    expect(src).toMatch(/revalidate:\s*30\b/);
  });

  it('first body statement is `await requireRole(\'manager\')` (AC5 defense-in-depth)', () => {
    // Mirrors the walker in tests/auth/admin-routes.test.ts so future
    // refactors that split the page into multiple statements still pass
    // — provided the FIRST statement remains the requireRole call.
    const src = readFileSync(PAGE_PATH, 'utf8');
    const exportMatch = src.match(
      /export\s+default\s+async\s+function\s+\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/,
    );
    expect(exportMatch).toBeTruthy();
    const bodyStart = exportMatch!.index! + exportMatch![0].length;

    let i = bodyStart;
    const advancePastTrivia = (): void => {
      while (i < src.length) {
        if (/\s/.test(src[i]!)) {
          i += 1;
          continue;
        }
        if (src.slice(i, i + 2) === '//') {
          const eol = src.indexOf('\n', i);
          i = eol === -1 ? src.length : eol + 1;
          continue;
        }
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
    expect(firstStmt).toMatch(
      /^(?:const\s*\{\s*profile\s*\}\s*=\s*)?await\s+requireRole\(\s*['"]manager['"]\s*\)/,
    );
  });

  it('imports `unstable_cache` from `next/cache`', () => {
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).toMatch(/import\s*\{[^}]*\bunstable_cache\b[^}]*\}\s*from\s*['"]next\/cache['"]/);
  });

  it('imports `requireRole` from `@/lib/auth/requireRole`', () => {
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).toMatch(
      /import\s*\{\s*requireRole\s*\}\s*from\s*['"]@\/lib\/auth\/requireRole['"]/,
    );
  });

  it('uses cookie-scoped `createClient()` from `@/lib/supabase/server` (R1 mitigation)', () => {
    // Premortem R1: never reach for the service-role admin client on the
    // dashboard. Source-grep both the import and the absence of
    // `lib/supabase/admin` to lock it down.
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).toMatch(/from\s*['"]@\/lib\/supabase\/server['"]/);
    expect(src).not.toMatch(/from\s*['"]@\/lib\/supabase\/admin['"]/);
  });

  it('source does NOT contain `\'use client\'` (server-component-only)', () => {
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).not.toContain("'use client'");
    expect(src).not.toContain('"use client"');
  });
});
