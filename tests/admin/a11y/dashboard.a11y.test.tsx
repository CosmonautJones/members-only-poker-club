/**
 * axe-core a11y sweep for `app/(admin)/admin/page.tsx` —
 * ADR-0035 AC33 / WD.T23 (t20).
 *
 * Run locally:    pnpm test tests/admin/a11y/dashboard.a11y.test.tsx
 * Prerequisites:  none — pure module mocks (no DB, no network).
 *
 * Contract per AC33:
 *   - Render the dashboard via RTL.
 *   - Run axe-core (vitest-axe) over the rendered container.
 *   - Assert NO `serious` or `critical` violations.
 *   - `moderate` / `minor` violations are tolerated at this layer;
 *     the e2e a11y suite (`tests-e2e/a11y.spec.ts`) is the formal
 *     audit surface (ADR-0026).
 *
 * Mocking mirrors `tests/admin/dashboard-page.test.tsx` so the SUT's
 * dependency chain stays consistent across both unit and a11y tests.
 */

import { describe, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

import { expectNoSeriousAxeViolations, BASE_MANAGER_PROFILE } from './_helpers';

// ---- Hoisted mock primitives ----------------------------------------------

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn<
    (required: string) => Promise<{
      profile: { id: string; role: string; full_name: string; email: string };
    }>
  >(),
  tableResolvers: new Map<
    string,
    { count?: number | null; data?: unknown; error?: { message: string } | null }
  >(),
}));

// ---- Mocks ----------------------------------------------------------------

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((p: string) => {
    const e = new Error(`NEXT_REDIRECT: ${p}`);
    (e as Error & { digest?: string }).digest = `NEXT_REDIRECT;${p}`;
    throw e;
  }),
}));

// `unstable_cache` becomes a pass-through wrapper so the underlying
// supabase chain mock is exercised on every call (mirrors
// tests/admin/dashboard-page.test.tsx).
vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(
    fn: T,
    _keyParts?: readonly unknown[],
    _options?: { revalidate?: number; tags?: readonly string[] },
  ): T => fn,
  revalidateTag: vi.fn(),
}));

vi.mock('next/link', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- match Next's permissive Link prop signature in tests
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: mocks.requireRole,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    function makeChain(table: string) {
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
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

// ---- Import AFTER mocks ---------------------------------------------------

// eslint-disable-next-line import/first
import AdminDashboardPage from '@/app/(admin)/admin/page';

// ---- Fixtures -------------------------------------------------------------

const FIVE_AUDIT_ROWS = [
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
];

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: BASE_MANAGER_PROFILE });
  mocks.tableResolvers.clear();
  mocks.tableResolvers.set('profiles', { count: 2, error: null });
  mocks.tableResolvers.set('privacy_requests', { count: 1, error: null });
  mocks.tableResolvers.set('feature_flags', { count: 0, error: null });
  mocks.tableResolvers.set('audit_log', { data: FIVE_AUDIT_ROWS, error: null });
});

// ---- Tests ----------------------------------------------------------------

describe('admin dashboard — axe-core a11y (AC33)', () => {
  it('has no serious or critical axe violations when rows are present', async () => {
    const tree = await AdminDashboardPage();
    const { container } = render(tree as React.ReactElement);
    await expectNoSeriousAxeViolations(container);
  });

  it('has no serious or critical axe violations in the empty-state branch', async () => {
    mocks.tableResolvers.set('audit_log', { data: [], error: null });
    const tree = await AdminDashboardPage();
    const { container } = render(tree as React.ReactElement);
    await expectNoSeriousAxeViolations(container);
  });
});
