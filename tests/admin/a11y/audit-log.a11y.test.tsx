/**
 * axe-core a11y sweep for `app/(admin)/admin/audit-log/page.tsx` —
 * ADR-0035 AC33 / WD.T23 (t20).
 *
 * Mock plumbing mirrors `tests/admin/audit-log-page.test.tsx`.
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
  queryAuditLog: vi.fn(),
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

vi.mock('@/app/(admin)/admin/audit-log/_actions/queryAuditLog', () => ({
  queryAuditLog: mocks.queryAuditLog,
}));

// Import AFTER mocks.
// eslint-disable-next-line import/first
import AuditLogPage from '@/app/(admin)/admin/audit-log/page';

// ---- Fixtures -------------------------------------------------------------

const FIVE_ROWS = [
  {
    id: 5,
    action: 'admin.member.role_changed',
    target_type: 'profile',
    target_id: 'uuid-a',
    before: { role: 'member' },
    after: { role: 'cashier' },
    ip: '192.168.1.10',
    user_agent: 'Mozilla/5.0 (Macintosh)',
    created_at: '2026-05-15T14:32:08.000Z',
    actor_id: 'uuid-actor-1',
    actor_email: 'manager@example.com',
    target_email: 'alice@example.com',
  },
  {
    id: 4,
    action: 'admin.verification.approved',
    target_type: 'profile',
    target_id: 'uuid-b',
    before: { id_verified_at: null },
    after: { id_verified_at: '2026-05-15T13:18:00Z' },
    ip: '192.168.1.10',
    user_agent: 'Mozilla/5.0 (Macintosh)',
    created_at: '2026-05-15T13:18:01.000Z',
    actor_id: 'uuid-actor-1',
    actor_email: 'manager@example.com',
    target_email: 'bob@example.com',
  },
  {
    id: 3,
    action: 'admin.privacy.export_approved',
    target_type: 'privacy_request',
    target_id: 'uuid-c',
    before: null,
    after: { status: 'approved' },
    ip: null,
    user_agent: null,
    created_at: '2026-05-15T12:00:00.000Z',
    actor_id: null,
    actor_email: null,
    target_email: null,
  },
];

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: BASE_MANAGER_PROFILE });
  mocks.queryAuditLog.mockReset();
  mocks.queryAuditLog.mockResolvedValue({
    rows: FIVE_ROWS,
    total: FIVE_ROWS.length,
    page: 1,
    pageSize: 50,
  });
});

async function renderPage(searchParams?: Record<string, string>): Promise<HTMLElement> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SUT prop typing varies between Next versions; runtime shape is just an object
  const props: any = searchParams ? { searchParams } : {};
  const tree = await AuditLogPage(props);
  const { container } = render(tree as React.ReactElement);
  return container;
}

// ---- Tests ----------------------------------------------------------------

describe('admin audit log — axe-core a11y (AC33)', () => {
  it('has no serious or critical axe violations with rows present', async () => {
    const container = await renderPage();
    await expectNoSeriousAxeViolations(container);
  });

  it('has no serious or critical axe violations in the empty-state branch', async () => {
    mocks.queryAuditLog.mockResolvedValueOnce({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
    const container = await renderPage();
    await expectNoSeriousAxeViolations(container);
  });

  it('has no serious or critical axe violations with the DST fall-back banner visible', async () => {
    // 2026 fall-back seam = 2026-11-01T07:00Z. A range straddling it
    // surfaces the role=status banner.
    const container = await renderPage({
      fromCentral: '2026-11-01T00:30',
      toCentral: '2026-11-01T03:30',
    });
    await expectNoSeriousAxeViolations(container);
  });

  it('has no serious or critical axe violations with the R8 anonymized-profile banner visible', async () => {
    mocks.queryAuditLog.mockResolvedValueOnce({
      rows: [
        {
          ...FIVE_ROWS[0]!,
          actor_email: 'del:abcd1234',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    const container = await renderPage();
    await expectNoSeriousAxeViolations(container);
  });
});
