/**
 * axe-core a11y sweep for `app/(admin)/admin/payments/page.tsx` —
 * ADR-0035 AC33 / Slice 4D followup for the ADR-0036 Slice 1 surface.
 *
 * Run locally:    pnpm test tests/admin/a11y/payments-overview.a11y.test.tsx
 * Prerequisites:  none — pure module mocks (no DB, no network).
 *
 * Contract per AC33:
 *   - Render the payments overview via RTL.
 *   - Run axe-core (vitest-axe) over the rendered container.
 *   - Assert NO `serious` or `critical` violations.
 *   - Covers both the empty-state branch (all three cards count=0, Slice 1
 *     baseline) and the populated branch (non-zero counts surface
 *     anchor links to the Slice 2 sub-surfaces).
 *
 * Mocking mirrors `tests/admin/payments/overview-page.test.tsx`.
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
  tableResolvers: new Map<string, { count?: number | null; error?: { message: string } | null }>(),
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
        'neq',
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
        onFulfilled: (v: { count?: number | null; error?: { message: string } | null }) => unknown,
      ) => {
        const value = mocks.tableResolvers.get(table) ?? { count: 0, error: null };
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
import PaymentsOverviewPage from '@/app/(admin)/admin/payments/page';

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: BASE_MANAGER_PROFILE });
  mocks.tableResolvers.clear();
  // Slice 1 baseline: every table reports zero rows so the three cards
  // render their empty-state literals.
  mocks.tableResolvers.set('payments', { count: 0, error: null });
  mocks.tableResolvers.set('stripe_webhook_events', { count: 0, error: null });
  mocks.tableResolvers.set('disputes', { count: 0, error: null });
});

// ---- Tests ----------------------------------------------------------------

describe('admin payments overview — axe-core a11y (AC33)', () => {
  it('has no serious or critical axe violations in the empty-state branch', async () => {
    const tree = await PaymentsOverviewPage();
    const { container } = render(tree as React.ReactElement);
    await expectNoSeriousAxeViolations(container);
  });

  it('has no serious or critical axe violations when all three cards have counts', async () => {
    mocks.tableResolvers.set('payments', { count: 5, error: null });
    mocks.tableResolvers.set('stripe_webhook_events', { count: 2, error: null });
    mocks.tableResolvers.set('disputes', { count: 7, error: null });
    const tree = await PaymentsOverviewPage();
    const { container } = render(tree as React.ReactElement);
    await expectNoSeriousAxeViolations(container);
  });
});
