/**
 * Unit tests for `app/(admin)/admin/privacy/page.tsx` — the AC23
 * privacy-request queue (ADR-0035 WC.T17).
 *
 * Run locally:    pnpm test tests/admin/privacy-page.test.tsx
 * Prerequisites:  none — pure module mocks (no DB, no network).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC23
 *       (status filter; columns requester profile / kind / submitted_at
 *       UTC+Central; profile fallback to requester_email when
 *       status='completed' AND kind='delete'; per-row actions wired to
 *       typed-confirmation dialogs).
 *
 * Mocking strategy mirrors `tests/admin/verifications-page.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
  // Result map keyed by table name — privacy_requests OR profiles.
  results: Map<string, TableResult>;
  // Captured filter values across .eq() calls so tests can assert the
  // status filter flows through.
  lastEqCalls: Array<{ table: string; column: string; value: unknown }>;
  // Action spies for the three server actions (mounted by the queue's
  // client component when a row's action button is clicked).
  approveExportAction: ReturnType<typeof vi.fn>;
  approveDeletionAction: ReturnType<typeof vi.fn>;
  rejectRequestAction: ReturnType<typeof vi.fn>;
};

const mocks: MockShape = vi.hoisted(
  (): MockShape => ({
    requireRole: vi.fn(),
    results: new Map<string, TableResult>(),
    lastEqCalls: [],
    approveExportAction: vi.fn(async () => ({ ok: true, expiresAt: '2026-05-16T00:00:00.000Z' })),
    approveDeletionAction: vi.fn(async () => ({ ok: true })),
    rejectRequestAction: vi.fn(async () => ({ ok: true })),
  }),
);

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
      for (const m of ['select', 'is', 'not', 'like', 'order', 'limit', 'gt', 'gte', 'lt', 'lte', 'or', 'ilike', 'filter', 'range']) {
        chain[m] = passthrough;
      }
      chain['eq'] = (column: string, value: unknown) => {
        mocks.lastEqCalls.push({ table, column, value });
        return chain;
      };
      chain['in'] = (column: string, value: unknown) => {
        mocks.lastEqCalls.push({ table, column, value });
        return chain;
      };
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

// Mock the `'use server'` re-export shim so the client component can
// import without hitting `server-only`.
vi.mock('@/app/(admin)/admin/privacy/_actions', () => ({
  approveExportAction: mocks.approveExportAction,
  approveDeletionAction: mocks.approveDeletionAction,
  rejectRequestAction: mocks.rejectRequestAction,
}));

// ---- Import AFTER vi.mock so the SUT picks up the stubs -------------------

// eslint-disable-next-line import/first
import PrivacyPage from '@/app/(admin)/admin/privacy/page';

// ---- Test helpers ---------------------------------------------------------

const baseProfile = {
  id: 'uuid-test-manager',
  role: 'manager',
  full_name: 'Test Manager',
  email: 'manager@example.com',
};

// Stable submitted_at across tests so timestamp assertions pin literal
// substrings. 2026-05-15T14:32:08 UTC = 09:32:08 CDT in America/Chicago.
const SUBMITTED_AT_ISO = '2026-05-15T14:32:08.000Z';

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: baseProfile });
  mocks.results.clear();
  mocks.lastEqCalls = [];
  mocks.approveExportAction.mockClear();
  mocks.approveDeletionAction.mockClear();
  mocks.rejectRequestAction.mockClear();
});

/**
 * Render the page and unwrap its Suspense boundary so the queue body
 * is materialized. Mirrors `tests/admin/verifications-page.test.tsx`.
 */
async function renderPage(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<void> {
  const tree = (await PrivacyPage({ searchParams })) as React.ReactElement;
  const resolved = await resolveAsyncChildren(tree);
  render(resolved);
}

async function resolveAsyncChildren(node: React.ReactNode): Promise<React.ReactElement> {
  if (
    node &&
    typeof node === 'object' &&
    'then' in (node as object) &&
    typeof (node as Promise<unknown>).then === 'function'
  ) {
    const awaited = (await node) as React.ReactNode;
    return resolveAsyncChildren(awaited);
  }
  if (!node || typeof node !== 'object' || !('props' in (node as object))) {
    return node as React.ReactElement;
  }
  const el = node as React.ReactElement & { type: unknown };
  if (typeof el.type === 'function') {
    const fn = el.type as (props: Record<string, unknown>) => unknown;
    try {
      const ret = fn(el.props as Record<string, unknown>);
      if (ret && typeof ret === 'object' && 'then' in ret) {
        const awaited = (await (ret as Promise<unknown>)) as React.ReactNode;
        return resolveAsyncChildren(awaited);
      }
    } catch {
      // pass through
    }
  }
  const props = el.props as { children?: React.ReactNode };
  if (props.children !== undefined) {
    if (Array.isArray(props.children)) {
      const newKids = await Promise.all(
        props.children.map(async (k, i) => {
          const resolved = await resolveAsyncChildren(k);
          if (
            resolved &&
            typeof resolved === 'object' &&
            'props' in (resolved as object) &&
            (resolved as React.ReactElement).key == null
          ) {
            return { ...(resolved as React.ReactElement), key: `__t-${i}` };
          }
          return resolved;
        }),
      );
      return { ...el, props: { ...el.props, children: newKids } };
    }
    const newChild = await resolveAsyncChildren(props.children);
    return { ...el, props: { ...el.props, children: newChild } };
  }
  return el;
}

function requestRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'uuid-req-a',
    profile_id: 'uuid-profile-a',
    requester_email: 'alice.captured@example.com',
    kind: 'export',
    status: 'pending',
    submitted_at: SUBMITTED_AT_ISO,
    ...overrides,
  };
}

function profileRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'uuid-profile-a',
    full_name: 'Alice Adams',
    email: 'alice@example.com',
    ...overrides,
  };
}

// =============================================================================
// requireRole gate
// =============================================================================
describe('privacy page — requireRole gate', () => {
  it('calls requireRole("manager") as the first body statement', async () => {
    await renderPage();
    expect(mocks.requireRole).toHaveBeenCalledTimes(1);
    expect(mocks.requireRole).toHaveBeenCalledWith('manager');
  });

  it('propagates a thrown InsufficientRoleError from requireRole', async () => {
    const err = new Error('InsufficientRoleError');
    err.name = 'InsufficientRoleError';
    mocks.requireRole.mockRejectedValueOnce(err);
    await expect(PrivacyPage({ searchParams: {} })).rejects.toThrow(/InsufficientRoleError/);
  });
});

// =============================================================================
// Empty state
// =============================================================================
describe('privacy page — empty state', () => {
  it('renders the literal "No pending privacy requests." copy when no rows', async () => {
    mocks.results.set('privacy_requests', { data: [], error: null });
    await renderPage();
    expect(screen.getByText('No pending privacy requests.')).toBeTruthy();
  });
});

// =============================================================================
// Status filter
// =============================================================================
describe('privacy page — status filter', () => {
  it('defaults to status="pending"', async () => {
    mocks.results.set('privacy_requests', { data: [], error: null });
    await renderPage();
    const statusEq = mocks.lastEqCalls.find(
      (c) => c.table === 'privacy_requests' && c.column === 'status',
    );
    expect(statusEq).toBeTruthy();
    expect(statusEq!.value).toBe('pending');
  });

  it('flows ?status=completed through to the query', async () => {
    mocks.results.set('privacy_requests', { data: [], error: null });
    await renderPage({ status: 'completed' });
    const statusEq = mocks.lastEqCalls.find(
      (c) => c.table === 'privacy_requests' && c.column === 'status',
    );
    expect(statusEq?.value).toBe('completed');
  });

  it('clamps malformed ?status to "pending"', async () => {
    mocks.results.set('privacy_requests', { data: [], error: null });
    await renderPage({ status: 'not-a-status' });
    const statusEq = mocks.lastEqCalls.find(
      (c) => c.table === 'privacy_requests' && c.column === 'status',
    );
    expect(statusEq?.value).toBe('pending');
  });

  it('renders the status select with all four valid options', async () => {
    mocks.results.set('privacy_requests', { data: [], error: null });
    await renderPage();
    const sel = screen.getByTestId('privacy-status-select') as HTMLSelectElement;
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toEqual(['pending', 'in_progress', 'completed', 'rejected']);
  });
});

// =============================================================================
// Populated queue — kind=export pending row
// =============================================================================
describe('privacy page — populated queue (pending export)', () => {
  beforeEach(() => {
    mocks.results.set('privacy_requests', {
      data: [
        requestRow({
          id: 'uuid-req-export',
          profile_id: 'uuid-profile-a',
          requester_email: 'alice.captured@example.com',
          kind: 'export',
          status: 'pending',
        }),
      ],
      error: null,
    });
    mocks.results.set('profiles', {
      data: [profileRow({ id: 'uuid-profile-a' })],
      error: null,
    });
  });

  it('renders requester full_name + profiles.email from joined profile', async () => {
    await renderPage();
    expect(screen.getByText('Alice Adams')).toBeTruthy();
    expect(screen.getByText('alice@example.com')).toBeTruthy();
  });

  it('renders the kind pill with data-kind="export"', async () => {
    await renderPage();
    const pill = screen.getByText('export');
    expect(pill.getAttribute('data-kind')).toBe('export');
  });

  it('renders UTC + Central timestamp pair', async () => {
    await renderPage();
    expect(screen.getByText(/14:32:08\s+UTC/)).toBeTruthy();
    expect(screen.getByText(/09:32:08\s+CDT/)).toBeTruthy();
  });

  it('renders the Approve export button AND the Reject button', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: /^approve export$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeTruthy();
    // No Approve deletion button on an export row.
    expect(screen.queryByRole('button', { name: /^approve deletion$/i })).toBeNull();
  });
});

// =============================================================================
// Populated queue — kind=delete pending row
// =============================================================================
describe('privacy page — populated queue (pending delete)', () => {
  beforeEach(() => {
    mocks.results.set('privacy_requests', {
      data: [
        requestRow({
          id: 'uuid-req-delete',
          profile_id: 'uuid-profile-b',
          requester_email: 'bob.captured@example.com',
          kind: 'delete',
          status: 'pending',
        }),
      ],
      error: null,
    });
    mocks.results.set('profiles', {
      data: [profileRow({ id: 'uuid-profile-b', full_name: 'Bob Brown', email: 'bob@example.com' })],
      error: null,
    });
  });

  it('renders the Approve deletion button (NOT Approve export) plus Reject', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: /^approve deletion$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^approve export$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeTruthy();
  });
});

// =============================================================================
// Profile fallback when status=completed AND kind=delete (anonymized)
// =============================================================================
describe('privacy page — anonymized fallback', () => {
  it('falls back to requester_email when status=completed AND kind=delete', async () => {
    mocks.results.set('privacy_requests', {
      data: [
        requestRow({
          id: 'uuid-req-completed-delete',
          profile_id: 'uuid-profile-anon',
          requester_email: 'real.email.captured@example.com',
          kind: 'delete',
          status: 'completed',
        }),
      ],
      error: null,
    });
    // Profile row's email is anonymized.
    mocks.results.set('profiles', {
      data: [
        profileRow({
          id: 'uuid-profile-anon',
          full_name: 'del:abc123',
          email: 'del:abc123@deleted.local',
        }),
      ],
      error: null,
    });
    await renderPage({ status: 'completed' });

    // The fallback uses the captured requester_email, NOT the
    // anonymized profile email.
    expect(screen.getByText('real.email.captured@example.com')).toBeTruthy();
    expect(screen.queryByText('del:abc123@deleted.local')).toBeNull();
    // Display name renders as '(anonymized)'.
    expect(screen.getByText('(anonymized)')).toBeTruthy();
  });

  it('does NOT fall back when status=completed AND kind=export (profile still readable)', async () => {
    mocks.results.set('privacy_requests', {
      data: [
        requestRow({
          id: 'uuid-req-completed-export',
          profile_id: 'uuid-profile-c',
          requester_email: 'captured@example.com',
          kind: 'export',
          status: 'completed',
        }),
      ],
      error: null,
    });
    mocks.results.set('profiles', {
      data: [profileRow({ id: 'uuid-profile-c', full_name: 'Carol Carter', email: 'carol@example.com' })],
      error: null,
    });
    await renderPage({ status: 'completed' });

    // Profile remains readable post-export approval.
    expect(screen.getByText('Carol Carter')).toBeTruthy();
    expect(screen.getByText('carol@example.com')).toBeTruthy();
  });
});

// =============================================================================
// Non-pending rows have no action buttons (only the placeholder dash)
// =============================================================================
describe('privacy page — non-pending rows', () => {
  it('non-pending rows render the placeholder dash, not action buttons', async () => {
    mocks.results.set('privacy_requests', {
      data: [
        requestRow({
          id: 'uuid-req-rejected',
          status: 'rejected',
          kind: 'export',
        }),
      ],
      error: null,
    });
    mocks.results.set('profiles', {
      data: [profileRow()],
      error: null,
    });
    await renderPage({ status: 'rejected' });

    expect(screen.getByTestId('privacy-no-actions-uuid-req-rejected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^approve export$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^approve deletion$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^reject$/i })).toBeNull();
  });
});

// =============================================================================
// Dialog wiring (smoke test — the typed-confirmation dialog opens)
// =============================================================================
describe('privacy page — action dialog wiring', () => {
  beforeEach(() => {
    mocks.results.set('privacy_requests', {
      data: [
        requestRow({
          id: 'uuid-req-export',
          profile_id: 'uuid-profile-a',
          requester_email: 'alice.captured@example.com',
          kind: 'export',
        }),
      ],
      error: null,
    });
    mocks.results.set('profiles', {
      data: [profileRow()],
      error: null,
    });
  });

  it('Approve export button opens the typed-confirmation dialog', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /^approve export$/i }));
    const dialog = await screen.findByTestId('typed-confirmation-dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('Reject button opens a typed-confirmation dialog requiring "reject"', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    const dialog = await screen.findByTestId('typed-confirmation-dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // Reject button is disabled until 'reject' is typed.
    const confirm = screen.getByTestId('typed-confirmation-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByTestId('typed-confirmation-input'), 'reject');
    expect(confirm.disabled).toBe(false);
  });
});

// =============================================================================
// Approve deletion dialog requires typing the requester's email
// =============================================================================
describe('privacy page — approve deletion typed-confirmation gate', () => {
  it('Approve deletion: confirm disabled until requester_email typed exactly', async () => {
    const user = userEvent.setup();
    mocks.results.set('privacy_requests', {
      data: [
        requestRow({
          id: 'uuid-req-delete',
          profile_id: 'uuid-profile-b',
          requester_email: 'jane@example.com',
          kind: 'delete',
        }),
      ],
      error: null,
    });
    mocks.results.set('profiles', {
      data: [profileRow({ id: 'uuid-profile-b' })],
      error: null,
    });
    await renderPage();
    await user.click(screen.getByRole('button', { name: /^approve deletion$/i }));
    const confirm = screen.getByTestId('typed-confirmation-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByTestId('typed-confirmation-input'), 'jane@example.co');
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByTestId('typed-confirmation-input'), 'm');
    expect(confirm.disabled).toBe(false);
  });
});
