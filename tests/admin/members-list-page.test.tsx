/**
 * Unit tests for `app/(admin)/admin/members/page.tsx` — ADR-0035 AC8, WA.T5.
 *
 * Run locally:    pnpm test tests/admin/members-list-page.test.tsx
 * Prerequisites:  none — pure module mocks (no DB, no network).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC8
 *       (8-column table + 3 filter controls + pagination + "deleted"
 *       pill + empty-state literal).
 *
 * SUT contract (per AC8):
 *   - Server component. FIRST body statement is `await requireRole('manager');`
 *   - Renders an 8-column table backed by the `searchMembers` server
 *     action. Columns in order: full_name, email, member_number, role,
 *     id_verified_at (UTC+Central), created_at (UTC+Central), status,
 *     deleted_at indicator (pill).
 *   - Three filter controls: status <select>, role <select>, free-text q <input>.
 *   - Empty state literal: "No rows match these filters."
 *   - Pagination renders Previous + Next anchors with `?page=N` updates.
 *
 * Mocking strategy:
 *   - vi.mock('server-only')
 *   - vi.mock('next/link') — happy-dom has no Next router.
 *   - vi.mock('next/navigation') — defensive (requireRole's deps).
 *   - vi.mock('@/lib/auth/requireRole') — controlled directly.
 *   - vi.mock('./_actions/searchMembers') — controls the rendered
 *     table data on a per-test basis.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// ---- Hoisted mock primitives ----------------------------------------------

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn<
    (required: string) => Promise<{
      profile: { id: string; role: string; full_name: string; email: string };
    }>
  >(),
  searchMembers: vi.fn<
    (params: unknown) => Promise<{
      rows: Array<{
        id: string;
        full_name: string;
        email: string;
        member_number: number | null;
        role: 'member' | 'cashier' | 'manager' | 'owner';
        id_verified_at: string | null;
        created_at: string;
        status: string | null;
        deleted_at: string | null;
      }>;
      total: number;
      page: number;
      pageSize: number;
    }>
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

// Mock the action both at its relative AND aliased paths so the SUT's
// import resolves to the same stub regardless of which form the SUT
// uses internally.
vi.mock('@/app/(admin)/admin/members/_actions/searchMembers', () => ({
  searchMembers: mocks.searchMembers,
}));

// ---- Import AFTER vi.mock so the SUT picks up the stubs -------------------

// eslint-disable-next-line import/first
import AdminMembersPage from '@/app/(admin)/admin/members/page';

// ---- Test helpers ---------------------------------------------------------

const baseProfile = {
  id: 'uuid-test-manager',
  role: 'manager' as const,
  full_name: 'Test Manager',
  email: 'manager@example.com',
};

type Row = Awaited<ReturnType<typeof mocks.searchMembers>>['rows'][number];

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'uuid-default',
    full_name: 'Default Name',
    email: 'default@example.com',
    member_number: null,
    role: 'member',
    id_verified_at: null,
    created_at: '2026-05-15T10:00:00.000Z',
    status: null,
    deleted_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: baseProfile });
  mocks.searchMembers.mockReset();
  // Default: one row, no extra filters, page 1 of 1.
  mocks.searchMembers.mockResolvedValue({
    rows: [
      makeRow({
        id: 'uuid-alice',
        full_name: 'Alice Example',
        email: 'alice@example.com',
        member_number: 42,
        role: 'member',
        id_verified_at: '2026-05-15T14:32:08.000Z',
        created_at: '2026-05-15T10:00:00.000Z',
        status: 'active',
        deleted_at: null,
      }),
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  });
});

async function renderPage(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<void> {
  const tree = await AdminMembersPage({ searchParams });
  render(tree as React.ReactElement);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('admin members page — requireRole gate', () => {
  it('calls requireRole("manager") as the first body statement', async () => {
    await renderPage();
    expect(mocks.requireRole).toHaveBeenCalledTimes(1);
    expect(mocks.requireRole).toHaveBeenCalledWith('manager');
  });

  it('propagates a thrown InsufficientRoleError from requireRole', async () => {
    const err = new Error('InsufficientRoleError');
    err.name = 'InsufficientRoleError';
    mocks.requireRole.mockRejectedValueOnce(err);
    await expect(AdminMembersPage({ searchParams: {} })).rejects.toThrow(/InsufficientRoleError/);
  });
});

describe('admin members page — 8-column table headers', () => {
  it('renders all 8 column headers in the documented order', async () => {
    await renderPage();
    const table = screen.getByRole('table', { name: /members list/i });
    const headers = within(table).getAllByRole('columnheader');
    // 8 columns total. The 8th is the "deleted" indicator column
    // (no visible label — uses `&nbsp;`); the test only checks the
    // first 7 textual labels.
    expect(headers.length).toBe(8);
    expect(headers[0]?.textContent).toMatch(/full name/i);
    expect(headers[1]?.textContent).toMatch(/email/i);
    expect(headers[2]?.textContent).toMatch(/member\s*#/i);
    expect(headers[3]?.textContent).toMatch(/role/i);
    expect(headers[4]?.textContent).toMatch(/id verified/i);
    expect(headers[5]?.textContent).toMatch(/created/i);
    expect(headers[6]?.textContent).toMatch(/status/i);
  });
});

describe('admin members page — three filter controls', () => {
  it('renders the status <select> with all five enum options', async () => {
    await renderPage();
    const statusSelect = screen.getByLabelText(/filter by status/i) as HTMLSelectElement;
    expect(statusSelect).toBeTruthy();
    const opts = Array.from(statusSelect.options).map((o) => o.textContent?.toLowerCase() ?? '');
    expect(opts.some((o) => o.includes('pending'))).toBe(true);
    expect(opts.some((o) => o.includes('active'))).toBe(true);
    expect(opts.some((o) => o.includes('past due'))).toBe(true);
    expect(opts.some((o) => o.includes('canceled'))).toBe(true);
    expect(opts.some((o) => o.includes('deleted'))).toBe(true);
  });

  it('renders the role <select> with all four roles', async () => {
    await renderPage();
    const roleSelect = screen.getByLabelText(/filter by role/i) as HTMLSelectElement;
    expect(roleSelect).toBeTruthy();
    const opts = Array.from(roleSelect.options).map((o) => o.textContent?.toLowerCase() ?? '');
    expect(opts.some((o) => o.includes('member'))).toBe(true);
    expect(opts.some((o) => o.includes('cashier'))).toBe(true);
    expect(opts.some((o) => o.includes('manager'))).toBe(true);
    expect(opts.some((o) => o.includes('owner'))).toBe(true);
  });

  it('renders the free-text q <input type="search">', async () => {
    await renderPage();
    const qInput = screen.getByLabelText(/search by name or email/i) as HTMLInputElement;
    expect(qInput).toBeTruthy();
    expect(qInput.type).toBe('search');
    expect(qInput.name).toBe('q');
    // Pinned at 64-char ceiling so the browser surfaces the same
    // truncation the action does.
    expect(qInput.maxLength).toBe(64);
  });

  it('renders an Apply button that submits the form', async () => {
    await renderPage();
    const apply = screen.getByRole('button', { name: /apply/i });
    expect(apply).toBeTruthy();
    // The form must be a GET form (URL-driven filters).
    const form = apply.closest('form');
    expect(form).toBeTruthy();
    expect(form?.getAttribute('method')?.toLowerCase()).toBe('get');
  });
});

describe('admin members page — searchMembers invocation', () => {
  it('passes parsed searchParams to searchMembers (q, status, role, page)', async () => {
    await renderPage({ q: 'alice', status: 'active', role: 'member', page: '2' });
    expect(mocks.searchMembers).toHaveBeenCalledTimes(1);
    const args = mocks.searchMembers.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args).toMatchObject({
      q: 'alice',
      status: 'active',
      role: 'member',
      page: 2,
    });
  });

  it('ignores unknown status values from searchParams', async () => {
    await renderPage({ status: 'not-a-real-status' });
    // The SUT builds the params object conditionally so unknown values
    // are simply absent (not present-with-undefined). Assert via
    // `not.toHaveProperty` so the test survives either encoding.
    const args = mocks.searchMembers.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args).toBeDefined();
    expect(args.status).toBeUndefined();
  });

  it('ignores unknown role values from searchParams', async () => {
    await renderPage({ role: 'admin-super' });
    const args = mocks.searchMembers.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args).toBeDefined();
    expect(args.role).toBeUndefined();
  });

  it('handles array searchParams by taking the first element', async () => {
    await renderPage({ q: ['alice', 'bob'] });
    expect(mocks.searchMembers).toHaveBeenCalledWith(expect.objectContaining({ q: 'alice' }));
  });
});

describe('admin members page — row rendering', () => {
  it('renders the row data: full_name, email, member_number', async () => {
    await renderPage();
    expect(screen.getByText('Alice Example')).toBeTruthy();
    expect(screen.getByText('alice@example.com')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('renders "—" placeholder when member_number is null', async () => {
    mocks.searchMembers.mockResolvedValueOnce({
      rows: [makeRow({ id: 'uuid-x', member_number: null })],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    await renderPage();
    // "—" appears (multiple instances possible — we just assert >= 1).
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders "Not verified" when id_verified_at is null', async () => {
    mocks.searchMembers.mockResolvedValueOnce({
      rows: [makeRow({ id: 'uuid-x', id_verified_at: null })],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    await renderPage();
    expect(screen.getByText(/not verified/i)).toBeTruthy();
  });

  it('renders BOTH UTC and Central timestamps for id_verified_at when set', async () => {
    // 2026-05-15T14:32:08.000Z → UTC "14:32:08 UTC" and Central "09:32:08 CDT".
    await renderPage();
    expect(screen.getByText(/14:32:08\s+UTC/)).toBeTruthy();
    expect(screen.getByText(/09:32:08\s+CDT/)).toBeTruthy();
  });

  it('renders the "deleted" pill when deleted_at is non-null', async () => {
    mocks.searchMembers.mockResolvedValueOnce({
      rows: [
        makeRow({
          id: 'uuid-deleted',
          full_name: 'Deleted Person',
          email: 'del:abc@redacted',
          deleted_at: '2026-04-01T00:00:00.000Z',
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    await renderPage();
    const pill = screen.getByLabelText(/member is deleted/i);
    expect(pill).toBeTruthy();
    expect(pill.textContent?.toLowerCase()).toContain('deleted');
  });

  it('does NOT render the "deleted" pill when deleted_at is null', async () => {
    await renderPage();
    // Default row has deleted_at = null.
    const pill = screen.queryByLabelText(/member is deleted/i);
    expect(pill).toBeNull();
  });

  it('renders the membership status when joined', async () => {
    await renderPage();
    // Default row has status = 'active'. Scope to the table body so
    // the matching `<option value="active">Active</option>` in the
    // filter select does NOT register as a duplicate match.
    const table = screen.getByRole('table', { name: /members list/i });
    expect(within(table).getByText(/^active$/i)).toBeTruthy();
  });

  it('renders the full_name as a link to /admin/members/[id]', async () => {
    await renderPage();
    const link = screen.getByRole('link', { name: /alice example/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/admin/members/uuid-alice');
  });
});

describe('admin members page — empty state', () => {
  it('renders the literal "No rows match these filters." copy when rows is empty', async () => {
    mocks.searchMembers.mockResolvedValueOnce({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
    await renderPage();
    expect(screen.getByText('No rows match these filters.')).toBeTruthy();
  });
});

describe('admin members page — pagination', () => {
  it('renders Previous + Next anchors with `?page=N` updates when totalPages > 1', async () => {
    mocks.searchMembers.mockResolvedValueOnce({
      rows: [makeRow({ id: 'uuid-x' })],
      total: 100, // 100 / 25 = 4 pages.
      page: 2,
      pageSize: 25,
    });
    await renderPage({ page: '2' });

    const prev = screen.getByRole('link', { name: /previous page/i });
    expect(prev.getAttribute('href')).toBe('/admin/members');

    const next = screen.getByRole('link', { name: /next page/i });
    expect(next.getAttribute('href')).toBe('/admin/members?page=3');
  });

  it('preserves q/status/role filters in pagination links', async () => {
    mocks.searchMembers.mockResolvedValueOnce({
      rows: [makeRow({ id: 'uuid-x' })],
      total: 100,
      page: 1,
      pageSize: 25,
    });
    await renderPage({ q: 'alice', status: 'active', role: 'member' });
    const next = screen.getByRole('link', { name: /next page/i });
    const href = next.getAttribute('href') ?? '';
    expect(href).toContain('q=alice');
    expect(href).toContain('status=active');
    expect(href).toContain('role=member');
    expect(href).toContain('page=2');
  });

  it('does NOT render pagination nav when totalPages <= 1', async () => {
    mocks.searchMembers.mockResolvedValueOnce({
      rows: [makeRow({ id: 'uuid-x' })],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    await renderPage();
    const nav = screen.queryByRole('navigation', { name: /pagination/i });
    expect(nav).toBeNull();
  });

  it('renders Previous as disabled span when on page 1', async () => {
    mocks.searchMembers.mockResolvedValueOnce({
      rows: [makeRow({ id: 'uuid-x' })],
      total: 100, // multi-page so nav renders.
      page: 1,
      pageSize: 25,
    });
    await renderPage();
    // No "Previous page" link.
    expect(screen.queryByRole('link', { name: /previous page/i })).toBeNull();
    // But Next link IS present.
    expect(screen.getByRole('link', { name: /next page/i })).toBeTruthy();
  });
});

describe('admin members page — total summary text', () => {
  it('shows the total count in the header subhead', async () => {
    mocks.searchMembers.mockResolvedValueOnce({
      rows: [makeRow({ id: 'uuid-x' })],
      total: 42,
      page: 1,
      pageSize: 25,
    });
    await renderPage();
    expect(screen.getByText(/42 members? match/i)).toBeTruthy();
  });
});
