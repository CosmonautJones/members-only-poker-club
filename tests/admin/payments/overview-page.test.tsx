/**
 * Unit tests for `app/(admin)/admin/payments/page.tsx` — the AC26
 * `/admin/payments` overview surface (ADR-0036 Slice 1 T15 / t10).
 *
 * Run locally:    pnpm test tests/admin/payments/overview-page.test.tsx
 * Prerequisites:  none — pure module mocks (no DB, no network).
 *
 * Spec: docs/specs/0036-payment-management-console-implementation.md
 *       AC26 (three-card overview with load-bearing empty-state copy)
 *       AC27 (`requireRole('manager')` is invoked; payment-specific
 *       discoverability test for the defense-in-depth gate — the
 *       cross-cutting walker `tests/auth/admin-routes-defense-in-depth.test.ts`
 *       also covers this file automatically).
 *
 * SUT contract (per AC26):
 *   - Server component. FIRST awaited statement is
 *     `await requireRole('manager');`.
 *   - Three cards with counts:
 *       • Recent payments   → query payments in last 14 days; click → `/admin/payments/refunds`
 *       • Webhook health    → query stripe_webhook_events WHERE processed_at IS NULL; click → `/admin/payments/webhooks`
 *       • Open disputes     → query disputes WHERE status not in ('closed','won','lost'); no-op anchor
 *   - Empty-state copy (load-bearing literals — pinned by these tests):
 *       • "**No payments yet.** The first payment will arrive once Stripe webhooks are wired (Slice 2)."
 *       • "**No webhook events received.** Webhook handler ships in Slice 2."
 *       • "**No open disputes.** Disputes flow in via the charge.dispute.created webhook (Slice 2)."
 *
 * Mocking strategy mirrors `tests/admin/dashboard-page.test.tsx`:
 *   - vi.mock('server-only')
 *   - vi.mock('next/navigation', { redirect })
 *   - vi.mock('next/link') — happy-dom has no Next.js router context.
 *   - vi.mock('@/lib/auth/requireRole') — control the profile returned.
 *   - vi.mock('@/lib/supabase/server') — fluent-builder spy that
 *     responds to `.from('payments' | 'stripe_webhook_events' | 'disputes')`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---- Hoisted mock primitives ----------------------------------------------

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn<
    (required: string) => Promise<{
      profile: { id: string; role: string; full_name: string; email: string };
    }>
  >(),
  // Each "table" responder returns a value-resolver for the supabase
  // fluent chain ending in `.select(..., { count: 'exact', head: true })`
  // (resolves to `{ count, error }`). The test sets the resolved value
  // ahead of time, and the SUT's `await` triggers it.
  tableResolvers: new Map<string, { count?: number | null; error?: { message: string } | null }>(),
}));

// ---- Mocks ----------------------------------------------------------------

// `server-only` is a guard re-export. Neutralize so the SUT imports cleanly
// under vitest (mirrors `tests/admin/dashboard-page.test.tsx`).
vi.mock('server-only', () => ({}));

// `next/navigation` is imported transitively by requireRole. We mock
// redirect to a throw so any unintended call surfaces clearly. The role-
// gate redirect paths are covered exhaustively by
// `tests/auth/admin-routes.test.ts`.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((p: string) => {
    const e = new Error(`NEXT_REDIRECT: ${p}`);
    (e as Error & { digest?: string }).digest = `NEXT_REDIRECT;${p}`;
    throw e;
  }),
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
// `tests/auth/admin-routes.test.ts`. This test only cares that the page
// calls it with `'manager'`.
vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: mocks.requireRole,
}));

// `lib/supabase/server` createClient — fluent-builder spy. The SUT issues
// these chains, each ending in a `.select(..., { count: 'exact', head: true })`
// awaited result:
//   payments:               .from('payments').select(..count head).gte('created_at', ...)
//   stripe_webhook_events:  .from('stripe_webhook_events').select(..count head).is('processed_at', null)
//   disputes:               .from('disputes').select(..count head).not('status', 'in', ...)
//
// Each method returns the same chain object, which is itself awaitable
// (we attach a `then` resolver). When the chain is awaited, it resolves
// to the value the test pre-loaded into `mocks.tableResolvers`.
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

// ---- Import AFTER vi.mock so the SUT picks up the stubs -------------------

// eslint-disable-next-line import/first
import PaymentsOverviewPage from '@/app/(admin)/admin/payments/page';

// ---- Test helpers ---------------------------------------------------------

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
  // Sensible defaults — empty operational state (the Slice 1 baseline,
  // before Stripe webhooks are wired in Slice 2).
  mocks.tableResolvers.set('payments', { count: 0, error: null });
  mocks.tableResolvers.set('stripe_webhook_events', { count: 0, error: null });
  mocks.tableResolvers.set('disputes', { count: 0, error: null });
});

async function renderPage(): Promise<void> {
  const tree = await PaymentsOverviewPage();
  render(tree as React.ReactElement);
}

// ---- Tests ----------------------------------------------------------------

describe('admin payments overview — requireRole gate (AC27)', () => {
  it("calls requireRole('manager') exactly once", async () => {
    await renderPage();
    expect(mocks.requireRole).toHaveBeenCalledTimes(1);
    expect(mocks.requireRole).toHaveBeenCalledWith('manager');
  });

  it('propagates a thrown InsufficientRoleError from requireRole (does not swallow)', async () => {
    const err = new Error('InsufficientRoleError');
    err.name = 'InsufficientRoleError';
    mocks.requireRole.mockRejectedValueOnce(err);
    await expect(PaymentsOverviewPage()).rejects.toThrow(/InsufficientRoleError/);
  });
});

describe('admin payments overview — three cards render with empty-state copy (AC26)', () => {
  // All three resolvers default to count=0 via the outer beforeEach. The
  // empty-state literals are LOAD-BEARING — tests grep for the exact text
  // because Slice 2 + Slice 3 surfaces consume the same JSX shape and any
  // copy drift would silently change downstream behavior.

  it('renders the Recent payments empty state with literal copy', async () => {
    await renderPage();
    // Markdown-style **bold** asterisks are part of the literal in the spec
    // — they render as plain text in this card (we are not parsing markdown,
    // just pinning the exact string).
    expect(
      screen.getByText(
        /No payments yet\.\s+The first payment will arrive once Stripe webhooks are wired \(Slice 2\)\./i,
      ),
    ).toBeTruthy();
  });

  it('renders the Webhook health empty state with literal copy', async () => {
    await renderPage();
    expect(
      screen.getByText(/No webhook events received\.\s+Webhook handler ships in Slice 2\./i),
    ).toBeTruthy();
  });

  it('renders the Open disputes empty state with literal copy', async () => {
    await renderPage();
    expect(
      screen.getByText(
        /No open disputes\.\s+Disputes flow in via the charge\.dispute\.created webhook \(Slice 2\)\./i,
      ),
    ).toBeTruthy();
  });
});

describe('admin payments overview — three cards render counts when non-zero (AC26)', () => {
  beforeEach(() => {
    mocks.tableResolvers.set('payments', { count: 5, error: null });
    mocks.tableResolvers.set('stripe_webhook_events', { count: 2, error: null });
    mocks.tableResolvers.set('disputes', { count: 7, error: null });
  });

  it('renders the Recent payments card with count 5 linking to /admin/payments/refunds', async () => {
    await renderPage();
    const card = screen.getByRole('link', { name: /recent payments: 5/i });
    expect(card).toBeTruthy();
    expect(card.getAttribute('href')).toBe('/admin/payments/refunds');
  });

  it('renders the Webhook health card with count 2 linking to /admin/payments/webhooks', async () => {
    await renderPage();
    const card = screen.getByRole('link', { name: /webhook health: 2/i });
    expect(card).toBeTruthy();
    expect(card.getAttribute('href')).toBe('/admin/payments/webhooks');
  });

  it('renders the Open disputes card with count 7 (no-op anchor — disputes list is post-v1 per ADR-0027)', async () => {
    await renderPage();
    // The disputes card is "click is a no-op anchor" per the spec —
    // assert presence of the count, not a click target. Use a
    // non-link role: the card is rendered as a non-anchor container
    // (or an anchor without an href). We pin on the count text + label.
    expect(screen.getByText(/open disputes/i)).toBeTruthy();
    // The count should render as the literal "7" inside the card.
    // Use data-testid so we don't collide with the dashboard-style "count
    // appears in a label" pattern.
    const count = screen.getByTestId('card-count-open-disputes');
    expect(count.textContent).toContain('7');
  });
});

describe('admin payments overview — counts gracefully degrade on query error', () => {
  // Per the dispatch envelope: "gracefully degrade if the query fails
  // (e.g., schema-absent — but tables now exist so this should never
  // fire); empty-state copy applies when count === 0."
  // We treat an `error` resolver as count=0 so the empty-state copy
  // renders. This protects against any unexpected DB-level outage from
  // breaking the page render.
  it('renders Recent payments empty state when the payments query returns an error', async () => {
    mocks.tableResolvers.set('payments', { count: null, error: { message: '42P01' } });
    await renderPage();
    expect(
      screen.getByText(
        /No payments yet\.\s+The first payment will arrive once Stripe webhooks are wired \(Slice 2\)\./i,
      ),
    ).toBeTruthy();
  });

  it('renders Webhook health empty state when the stripe_webhook_events query returns an error', async () => {
    mocks.tableResolvers.set('stripe_webhook_events', {
      count: null,
      error: { message: '42P01' },
    });
    await renderPage();
    expect(
      screen.getByText(/No webhook events received\.\s+Webhook handler ships in Slice 2\./i),
    ).toBeTruthy();
  });

  it('renders Open disputes empty state when the disputes query returns an error', async () => {
    mocks.tableResolvers.set('disputes', { count: null, error: { message: '42P01' } });
    await renderPage();
    expect(
      screen.getByText(
        /No open disputes\.\s+Disputes flow in via the charge\.dispute\.created webhook \(Slice 2\)\./i,
      ),
    ).toBeTruthy();
  });
});
