/**
 * axe-core a11y sweep for `app/(admin)/admin/members/[id]/page.tsx` —
 * ADR-0035 AC33 / WD.T23 (t20).
 *
 * Mirrors `tests/admin/member-detail-page.test.tsx` mock plumbing.
 */

import { describe, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

import { expectNoSeriousAxeViolations, BASE_MANAGER_PROFILE } from './_helpers';

// ---- Hoisted mock primitives ----------------------------------------------

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn<
    (
      required: string,
    ) => Promise<{
      profile: { id: string; role: string; full_name: string; email: string };
    }>
  >(),
  notFound: vi.fn(() => {
    const e = new Error('NEXT_NOT_FOUND');
    (e as Error & { digest?: string }).digest = 'NEXT_NOT_FOUND';
    throw e;
  }),
  tableResolvers: new Map<
    string,
    { data?: unknown; error?: { code?: string; message: string } | null }
  >(),
}));

// ---- Mocks ----------------------------------------------------------------

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
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

// Stub the client ActionsPanel so the page-level a11y test focuses on
// the page DOM only. The dialog component has its own a11y coverage via
// the typed-confirmation-dialog primitive tests (ADR-0023).
vi.mock('@/app/(admin)/admin/members/[id]/_components/actions-panel.client', () => ({
  ActionsPanel: ({
    profileId,
    memberEmail,
  }: {
    profileId: string;
    memberEmail: string;
  }) => (
    <div data-testid="actions-panel" data-profile-id={profileId} data-member-email={memberEmail}>
      <button type="button">Change role</button>
      <button type="button">Request re-verification</button>
      <button type="button">Open refund flow</button>
      <button type="button">Initiate deletion</button>
    </div>
  ),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    function makeChain(table: string) {
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      for (const m of [
        'select',
        'eq',
        'is',
        'not',
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
      const resolveValue = () =>
        mocks.tableResolvers.get(table) ?? { data: null, error: null };
      chain['maybeSingle'] = (): Promise<unknown> => Promise.resolve(resolveValue());
      chain['single'] = (): Promise<unknown> => Promise.resolve(resolveValue());
      chain['then'] = (
        onFulfilled: (v: {
          data?: unknown;
          error?: { code?: string; message: string } | null;
        }) => unknown,
      ) => Promise.resolve(resolveValue()).then(onFulfilled);
      return chain;
    }
    return {
      from: (table: string) => makeChain(table),
    };
  },
}));

// ---- Import AFTER mocks ---------------------------------------------------

// eslint-disable-next-line import/first
import MemberDetailPage from '@/app/(admin)/admin/members/[id]/page';

// ---- Fixtures -------------------------------------------------------------

const PROFILE_ROW = {
  id: 'uuid-target-member',
  full_name: 'Alice Example',
  email: 'alice@example.com',
  member_number: 42,
  role: 'member',
  dob: '1990-01-01',
  phone: '+15125550000',
  created_at: '2026-05-15T10:00:00.000Z',
  id_verified_at: '2026-05-15T14:32:08.000Z',
};

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: BASE_MANAGER_PROFILE });
  mocks.tableResolvers.clear();
  mocks.tableResolvers.set('profiles', { data: PROFILE_ROW, error: null });
  mocks.tableResolvers.set('memberships', {
    data: {
      status: 'active',
      current_period_start: '2026-04-15T00:00:00.000Z',
      current_period_end: '2026-05-15T00:00:00.000Z',
    },
    error: null,
  });
  mocks.tableResolvers.set('time_wallets', {
    data: { balance_cents: 12345 },
    error: null,
  });
  mocks.tableResolvers.set('audit_log', {
    data: [
      {
        id: 1,
        action: 'admin.member.role_changed',
        target_type: 'profile',
        target_id: 'uuid-target-member',
        created_at: '2026-05-15T14:32:08.000Z',
      },
    ],
    error: null,
  });
  mocks.tableResolvers.set('payments', {
    data: [
      {
        id: 'pay-1',
        amount_cents: 5000,
        status: 'succeeded',
        created_at: '2026-05-14T12:00:00.000Z',
      },
    ],
    error: null,
  });
});

async function renderPage(params = { id: 'uuid-target-member' }): Promise<HTMLElement> {
  const tree = await MemberDetailPage({ params });
  const { container } = render(tree as React.ReactElement);
  return container;
}

// ---- Tests ----------------------------------------------------------------

describe('admin member detail — axe-core a11y (AC33)', () => {
  it('has no serious or critical axe violations with all sections populated', async () => {
    const container = await renderPage();
    await expectNoSeriousAxeViolations(container);
  });

  it('has no serious or critical axe violations with schema-absent placeholders', async () => {
    // Force the "missing table" placeholders to render (Open Q 2 / Q 3).
    mocks.tableResolvers.set('memberships', {
      data: null,
      error: { code: '42P01', message: 'relation "memberships" does not exist' },
    });
    mocks.tableResolvers.set('time_wallets', {
      data: null,
      error: { code: '42P01', message: 'relation "time_wallets" does not exist' },
    });
    mocks.tableResolvers.set('payments', {
      data: null,
      error: { code: '42P01', message: 'relation "payments" does not exist' },
    });
    const container = await renderPage();
    await expectNoSeriousAxeViolations(container);
  });

  it('has no serious or critical axe violations in the self-edit banner branch', async () => {
    // Make the target profile's id match the actor's so the page renders
    // the SELF_EDIT_BANNER instead of the ActionsPanel.
    mocks.tableResolvers.set('profiles', {
      data: { ...PROFILE_ROW, id: BASE_MANAGER_PROFILE.id },
      error: null,
    });
    const container = await renderPage({ id: BASE_MANAGER_PROFILE.id });
    await expectNoSeriousAxeViolations(container);
  });
});
