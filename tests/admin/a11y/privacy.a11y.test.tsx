/**
 * axe-core a11y sweep for `app/(admin)/admin/privacy/page.tsx` —
 * ADR-0035 AC33 / WD.T23 (t20).
 *
 * The privacy page renders its queue body inside a `<Suspense>` boundary,
 * so we use the shared `resolveAsyncChildren` walker to materialize the
 * async server component. Mock plumbing mirrors
 * `tests/admin/privacy-page.test.tsx`.
 */

import { describe, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

import {
  expectNoSeriousAxeViolations,
  resolveAsyncChildren,
  BASE_MANAGER_PROFILE,
} from './_helpers';

// ---- Hoisted mock primitives ----------------------------------------------

type TableResult = {
  data: Array<Record<string, unknown>>;
  error: { message: string } | null;
};

type MockShape = {
  requireRole: ReturnType<
    typeof vi.fn<
      (required: string) => Promise<{
        profile: { id: string; role: string; full_name: string; email: string };
      }>
    >
  >;
  results: Map<string, TableResult>;
  approveExportAction: ReturnType<typeof vi.fn>;
  approveDeletionAction: ReturnType<typeof vi.fn>;
  rejectRequestAction: ReturnType<typeof vi.fn>;
};

const mocks: MockShape = vi.hoisted(
  (): MockShape => ({
    requireRole: vi.fn(),
    results: new Map<string, TableResult>(),
    approveExportAction: vi.fn(async () => ({ ok: true })),
    approveDeletionAction: vi.fn(async () => ({ ok: true })),
    rejectRequestAction: vi.fn(async () => ({ ok: true })),
  }),
);

// ---- Mocks ----------------------------------------------------------------

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((p: string) => {
    const e = new Error(`NEXT_REDIRECT: ${p}`);
    (e as Error & { digest?: string }).digest = `NEXT_REDIRECT;${p}`;
    throw e;
  }),
}));

vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: mocks.requireRole,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    function makeChain(table: string): Record<string, unknown> {
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      for (const m of [
        'select',
        'is',
        'not',
        'like',
        'order',
        'limit',
        'gt',
        'gte',
        'lt',
        'lte',
        'or',
        'ilike',
        'filter',
        'range',
      ]) {
        chain[m] = passthrough;
      }
      chain['eq'] = () => chain;
      chain['in'] = () => chain;
      chain['then'] = (onFulfilled: (v: TableResult) => unknown) => {
        const value: TableResult = mocks.results.get(table) ?? {
          data: [],
          error: null,
        };
        return Promise.resolve(value).then(onFulfilled);
      };
      return chain;
    }
    return {
      from: (table: string) => makeChain(table),
    };
  },
}));

vi.mock('@/app/(admin)/admin/privacy/_actions', () => ({
  approveExportAction: mocks.approveExportAction,
  approveDeletionAction: mocks.approveDeletionAction,
  rejectRequestAction: mocks.rejectRequestAction,
}));

// Stub the client-component PrivacyQueueActions so resolveAsyncChildren
// does not invoke a hook-using function component as a plain function
// (which surfaces React's "Invalid hook call" warning). The page-level
// a11y contract only requires that the actions cell's buttons be
// keyboard-reachable, role=button, and accessibly named — the
// production component does all three, and this stub mirrors those
// affordances.
vi.mock('@/app/(admin)/admin/privacy/_components/privacy-queue-actions.client', () => ({
  PrivacyQueueActions: ({
    requestId,
    kind,
  }: {
    requestId: string;
    kind: 'export' | 'delete';
    requesterEmail: string;
  }) => (
    <div
      data-testid={`privacy-queue-actions-${requestId}`}
      style={{ display: 'flex', gap: 8 }}
    >
      <button type="button" aria-label={kind === 'export' ? 'Approve export' : 'Approve deletion'}>
        {kind === 'export' ? 'Approve export' : 'Approve deletion'}
      </button>
      <button type="button" aria-label="Reject request">
        Reject
      </button>
    </div>
  ),
}));

// ---- Import AFTER mocks ---------------------------------------------------

// eslint-disable-next-line import/first
import PrivacyPage from '@/app/(admin)/admin/privacy/page';

// ---- Fixtures -------------------------------------------------------------

const SUBMITTED_AT_ISO = '2026-05-15T14:32:08.000Z';

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: BASE_MANAGER_PROFILE });
  mocks.results.clear();
  mocks.approveExportAction.mockClear();
  mocks.approveDeletionAction.mockClear();
  mocks.rejectRequestAction.mockClear();
});

async function renderPage(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<HTMLElement> {
  const tree = (await PrivacyPage({ searchParams })) as React.ReactElement;
  const resolved = await resolveAsyncChildren(tree);
  const { container } = render(resolved);
  return container;
}

// ---- Tests ----------------------------------------------------------------

describe('admin privacy — axe-core a11y (AC33)', () => {
  it('has no serious or critical axe violations with pending rows present', async () => {
    mocks.results.set('privacy_requests', {
      data: [
        {
          id: 'req-1',
          profile_id: 'uuid-alice',
          requester_email: 'alice@example.com',
          kind: 'export',
          status: 'pending',
          submitted_at: SUBMITTED_AT_ISO,
        },
        {
          id: 'req-2',
          profile_id: 'uuid-bob',
          requester_email: 'bob@example.com',
          kind: 'delete',
          status: 'pending',
          submitted_at: SUBMITTED_AT_ISO,
        },
      ],
      error: null,
    });
    mocks.results.set('profiles', {
      data: [
        { id: 'uuid-alice', full_name: 'Alice Example', email: 'alice@example.com' },
        { id: 'uuid-bob', full_name: 'Bob Beta', email: 'bob@example.com' },
      ],
      error: null,
    });
    const container = await renderPage();
    await expectNoSeriousAxeViolations(container);
  });

  it('has no serious or critical axe violations in the empty-state branch', async () => {
    mocks.results.set('privacy_requests', { data: [], error: null });
    const container = await renderPage();
    await expectNoSeriousAxeViolations(container);
  });

  it('has no serious or critical axe violations with anonymized completed-deletion rows', async () => {
    mocks.results.set('privacy_requests', {
      data: [
        {
          id: 'req-done',
          profile_id: 'uuid-anon',
          requester_email: 'gone@example.com',
          kind: 'delete',
          status: 'completed',
          submitted_at: SUBMITTED_AT_ISO,
        },
      ],
      error: null,
    });
    mocks.results.set('profiles', { data: [], error: null });
    const container = await renderPage({ status: 'completed' });
    await expectNoSeriousAxeViolations(container);
  });
});
