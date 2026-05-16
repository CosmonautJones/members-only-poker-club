/**
 * axe-core a11y sweep for `app/(admin)/admin/members/page.tsx` —
 * ADR-0035 AC33 / WD.T23 (t20).
 *
 * Mirrors `tests/admin/members-list-page.test.tsx`'s mock plumbing.
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

vi.mock('@/app/(admin)/admin/members/_actions/searchMembers', () => ({
  searchMembers: mocks.searchMembers,
}));

// ---- Import AFTER mocks ---------------------------------------------------

// eslint-disable-next-line import/first
import AdminMembersPage from '@/app/(admin)/admin/members/page';

// ---- Fixtures -------------------------------------------------------------

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
  mocks.requireRole.mockResolvedValue({ profile: BASE_MANAGER_PROFILE });
  mocks.searchMembers.mockReset();
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
      makeRow({
        id: 'uuid-bob',
        full_name: 'Bob Beta',
        email: 'bob@example.com',
        member_number: 43,
        role: 'cashier',
        id_verified_at: null,
        created_at: '2026-05-14T10:00:00.000Z',
        status: 'past_due',
        deleted_at: null,
      }),
      makeRow({
        id: 'uuid-carol',
        full_name: 'Carol Gone',
        email: 'carol@example.com',
        member_number: 44,
        role: 'member',
        id_verified_at: '2026-05-13T10:00:00.000Z',
        created_at: '2026-05-12T10:00:00.000Z',
        status: 'deleted',
        deleted_at: '2026-05-14T10:00:00.000Z',
      }),
    ],
    total: 3,
    page: 1,
    pageSize: 25,
  });
});

async function renderPage(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<HTMLElement> {
  const tree = await AdminMembersPage({ searchParams });
  const { container } = render(tree as React.ReactElement);
  return container;
}

// ---- Tests ----------------------------------------------------------------

describe('admin members list — axe-core a11y (AC33)', () => {
  it('has no serious or critical axe violations when rows are present', async () => {
    const container = await renderPage();
    await expectNoSeriousAxeViolations(container);
  });

  it('has no serious or critical axe violations in the empty-state branch', async () => {
    mocks.searchMembers.mockResolvedValueOnce({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
    const container = await renderPage();
    await expectNoSeriousAxeViolations(container);
  });

  it('has no serious or critical axe violations with pagination visible', async () => {
    // Generate 30 rows + total=80 so pagination renders Next link.
    const manyRows: Row[] = Array.from({ length: 25 }).map((_, i) =>
      makeRow({
        id: `uuid-${i}`,
        full_name: `Member ${i}`,
        email: `m${i}@example.com`,
        role: 'member',
        status: 'active',
      }),
    );
    mocks.searchMembers.mockResolvedValueOnce({
      rows: manyRows,
      total: 80,
      page: 2,
      pageSize: 25,
    });
    const container = await renderPage({ page: '2' });
    await expectNoSeriousAxeViolations(container);
  });
});
