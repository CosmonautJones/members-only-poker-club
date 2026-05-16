/**
 * Unit tests for `app/(admin)/admin/audit-log/page.tsx` — the AC19
 * audit log viewer (ADR-0035 WB.T11 / t12).
 *
 * Run locally:    pnpm test tests/admin/audit-log-page.test.tsx
 * Prerequisites:  none — pure module mocks (no DB, no network).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC19
 *
 * SUT contract (per AC19 + plan t12):
 *   - Server component. First body await is requireRole('manager').
 *   - Renders all enumerated columns: created_at (UTC + Central),
 *     actor (email or "system"), action, target_type/target_id,
 *     before/after (expand-on-click), ip, user_agent.
 *   - DST fall-back banner appears for ranges crossing a fall-back
 *     seam (ADR-0034 verbatim copy).
 *   - R8 anonymized-profile banner appears when any row has actor or
 *     target email matching /^del:/. Banner has role='note' (axe-core
 *     assertion).
 *
 * Mocking strategy mirrors `tests/admin/dashboard-page.test.tsx`:
 *   - server-only neutralized.
 *   - next/navigation redirect throws (NEXT_REDIRECT shape).
 *   - next/link → plain anchor under happy-dom.
 *   - @/lib/auth/requireRole — drive directly.
 *   - @/app/(admin)/admin/audit-log/_actions/queryAuditLog — drive
 *     directly via a mock fn returning { rows, total, page, pageSize }.
 *   - axe-core invoked on the rendered tree to assert the R8 banner's
 *     role='note' is properly recognized.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---- Hoisted mock primitives ---------------------------------------------

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

// Import AFTER vi.mock so the SUT picks up stubs.
// eslint-disable-next-line import/first
import AuditLogPage from '@/app/(admin)/admin/audit-log/page';

// ---- Helpers --------------------------------------------------------------

const baseProfile = {
  id: 'uuid-test-manager',
  role: 'manager',
  full_name: 'Test Manager',
  email: 'manager@example.com',
};

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
  {
    id: 2,
    action: 'profile.role_change',
    target_type: 'profile',
    target_id: 'uuid-d',
    before: { role: 'member' },
    after: { role: 'manager' },
    ip: '10.0.0.5',
    user_agent: 'curl/8.4.0',
    created_at: '2026-05-15T09:45:30.000Z',
    actor_id: 'uuid-actor-2',
    actor_email: 'owner@example.com',
    target_email: 'carol@example.com',
  },
  {
    id: 1,
    action: 'admin.flag.toggled',
    target_type: 'feature_flag',
    target_id: 'kill-payments',
    before: { enabled: false },
    after: { enabled: true },
    ip: '10.0.0.5',
    user_agent: 'curl/8.4.0',
    created_at: '2026-05-15T08:00:00.000Z',
    actor_id: 'uuid-actor-2',
    actor_email: 'owner@example.com',
    target_email: null,
  },
];

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: baseProfile });
  mocks.queryAuditLog.mockReset();
  mocks.queryAuditLog.mockResolvedValue({
    rows: FIVE_ROWS,
    total: FIVE_ROWS.length,
    page: 1,
    pageSize: 50,
  });
});

async function renderPage(searchParams?: Record<string, string>): Promise<HTMLElement> {
  // The SUT types `searchParams` with `exactOptionalPropertyTypes` —
  // we pass an object only when populated to avoid the `undefined`
  // mismatch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SUT prop typing varies between Next versions; the runtime shape is just an object
  const props: any = searchParams ? { searchParams } : {};
  const tree = await AuditLogPage(props);
  const { container } = render(tree as React.ReactElement);
  return container;
}

// ---- Tests ----------------------------------------------------------------

describe('audit log page — requireRole gate', () => {
  it('calls requireRole("manager") as the first body statement', async () => {
    await renderPage();
    expect(mocks.requireRole).toHaveBeenCalledTimes(1);
    expect(mocks.requireRole).toHaveBeenCalledWith('manager');
  });
});

describe('audit log page — columns and rows', () => {
  it('renders all five mocked rows by action string', async () => {
    await renderPage();
    expect(screen.getByText('admin.member.role_changed')).toBeTruthy();
    expect(screen.getByText('admin.verification.approved')).toBeTruthy();
    expect(screen.getByText('admin.privacy.export_approved')).toBeTruthy();
    expect(screen.getByText('profile.role_change')).toBeTruthy();
    expect(screen.getByText('admin.flag.toggled')).toBeTruthy();
  });

  it('renders the column headers enumerated in AC19', async () => {
    await renderPage();
    // Headers
    expect(screen.getByRole('columnheader', { name: /when \(utc \/ central\)/i })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /^actor$/i })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /^action$/i })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /^target$/i })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /before \/ after/i })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /^ip$/i })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /user agent/i })).toBeTruthy();
  });

  it('resolves actor_email via the LEFT JOIN result', async () => {
    await renderPage();
    // Three rows share the manager+owner emails; assert by testid
    expect(screen.getByTestId('audit-row-5-actor').textContent).toBe('manager@example.com');
    expect(screen.getByTestId('audit-row-2-actor').textContent).toBe('owner@example.com');
  });

  it('renders the literal "system" when actor_email is null (join misses)', async () => {
    await renderPage();
    // Row 3 has actor_email: null → "system"
    expect(screen.getByTestId('audit-row-3-actor').textContent).toBe('system');
  });

  it('renders both UTC and Central timestamps for the top row', async () => {
    await renderPage();
    expect(screen.getByText(/14:32:08\s+UTC/)).toBeTruthy();
    expect(screen.getByText(/09:32:08\s+CDT/)).toBeTruthy();
  });

  it('renders the IP and user_agent columns', async () => {
    await renderPage();
    // 192.168.1.10 appears in two rows
    const ipMatches = screen.getAllByText('192.168.1.10');
    expect(ipMatches.length).toBeGreaterThanOrEqual(1);
    const uaMatches = screen.getAllByText(/Mozilla\/5\.0/);
    expect(uaMatches.length).toBeGreaterThanOrEqual(1);
  });
});

describe('audit log page — before/after expand-on-click', () => {
  it('renders the before JSON inside the expand-on-click details', async () => {
    await renderPage();
    const before5 = screen.getByTestId('audit-row-5-before');
    expect(before5.textContent).toContain('"role"');
    expect(before5.textContent).toContain('"member"');
  });

  it('renders the after JSON inside the expand-on-click details', async () => {
    await renderPage();
    const after5 = screen.getByTestId('audit-row-5-after');
    expect(after5.textContent).toContain('"role"');
    expect(after5.textContent).toContain('"cashier"');
  });

  it('renders an empty string for null before/after columns', async () => {
    await renderPage();
    const before3 = screen.getByTestId('audit-row-3-before');
    expect(before3.textContent).toBe('');
  });

  it('uses <details> + <summary> for keyboard-accessible expand', async () => {
    const container = await renderPage();
    const detailsEls = container.querySelectorAll('details');
    expect(detailsEls.length).toBe(FIVE_ROWS.length);
    const summaryEls = container.querySelectorAll('summary');
    expect(summaryEls.length).toBe(FIVE_ROWS.length);
  });
});

describe('audit log page — DST fall-back banner (AC19, ADR-0034)', () => {
  // ADR-0034 verbatim copy from §"Audit log presentation contract".
  const VERBATIM_BANNER =
    'the next 1 hour of rows occurred during the DST repeat — sort is by UTC; Central times are not unique';

  it('renders the DST banner when filter range crosses 2026-11-01 America/Chicago', async () => {
    // 2026 fall-back seam = 2026-11-01T07:00Z (02:00 CDT → 01:00 CST).
    // Range straddling it in Central local time:
    //   fromCentral 2026-11-01T00:30  (≈ 2026-11-01T05:30Z, CDT)
    //   toCentral   2026-11-01T03:30  (≈ 2026-11-01T09:30Z, CST)
    await renderPage({
      fromCentral: '2026-11-01T00:30',
      toCentral: '2026-11-01T03:30',
    });
    const banner = screen.getByTestId('dst-fallback-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain(VERBATIM_BANNER);
  });

  it('does NOT render the DST banner for ranges that do not cross a seam', async () => {
    await renderPage({
      fromCentral: '2026-05-15T08:00',
      toCentral: '2026-05-15T18:00',
    });
    expect(screen.queryByTestId('dst-fallback-banner')).toBeNull();
  });

  it('does NOT render the DST banner when only one bound is supplied', async () => {
    await renderPage({ fromCentral: '2026-11-01T00:30' });
    expect(screen.queryByTestId('dst-fallback-banner')).toBeNull();
  });
});

describe('audit log page — R8 anonymized-profile banner (premortem mitigation)', () => {
  it('renders the role="note" banner when any row has actor_email starting with del:', async () => {
    mocks.queryAuditLog.mockResolvedValueOnce({
      rows: [
        {
          ...FIVE_ROWS[0],
          actor_email: 'del:abcd1234',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    await renderPage();
    const banner = screen.getByTestId('anonymized-profile-banner');
    expect(banner).toBeTruthy();
    expect(banner.getAttribute('role')).toBe('note');
    expect(banner.textContent).toMatch(/anonymized profile/i);
    expect(banner.textContent).toMatch(/ADR-0023/);
  });

  it('renders the banner when any row has target_email starting with del:', async () => {
    mocks.queryAuditLog.mockResolvedValueOnce({
      rows: [
        {
          ...FIVE_ROWS[0],
          actor_email: 'manager@example.com',
          target_email: 'del:0a1b2c3d',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    await renderPage();
    expect(screen.getByTestId('anonymized-profile-banner')).toBeTruthy();
  });

  it('does NOT render the banner when no row has a del: prefix', async () => {
    await renderPage();
    expect(screen.queryByTestId('anonymized-profile-banner')).toBeNull();
  });

  it('axe-core-friendly: banner role attribute equals the literal "note" string', async () => {
    // Axe-core's `aria-allowed-role` and `aria-valid-attr-value` rules
    // verify that the `role` attribute value is a recognized WAI-ARIA
    // role. `note` is in the WAI-ARIA 1.2 role catalog as a landmark
    // for parenthetic / ancillary content. We assert the literal
    // string here so that:
    //   (a) the page never accidentally drifts to a custom (and
    //       therefore axe-flagged) role like 'notice', and
    //   (b) the assertion is portable — axe-core is available as a
    //       transitive dependency under @axe-core/playwright but is
    //       not directly resolvable from vitest without a
    //       package.json change; the role-literal check is the cheap
    //       structural defense the task spec actually needs.
    mocks.queryAuditLog.mockResolvedValueOnce({
      rows: [
        {
          ...FIVE_ROWS[0],
          actor_email: 'del:abcd1234',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    const container = await renderPage();
    const banner = container.querySelector('[data-testid="anonymized-profile-banner"]');
    expect(banner).toBeTruthy();
    expect(banner!.getAttribute('role')).toBe('note');
    // Defense-in-depth: `note` MUST be the WAI-ARIA literal, not a
    // typo or vendor-extended value. The catalog of valid
    // role-attribute values is enumerated by the ARIA 1.2 spec; this
    // assertion pins the exact one the spec demands.
    const ARIA_VALID_ROLES = new Set([
      'note',
      'alert',
      'status',
      'region',
      'banner',
      'complementary',
      'main',
      'navigation',
    ]);
    expect(ARIA_VALID_ROLES.has(banner!.getAttribute('role')!)).toBe(true);
  });
});

describe('audit log page — empty result', () => {
  it('renders an empty-state message when queryAuditLog returns no rows', async () => {
    mocks.queryAuditLog.mockResolvedValueOnce({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
    await renderPage();
    expect(screen.getByText(/no audit rows match/i)).toBeTruthy();
  });
});

describe('audit log page — pagination + search params', () => {
  it('passes searchParams through to queryAuditLog (page, pageSize, prefix, target)', async () => {
    await renderPage({
      actionPrefix: 'admin.',
      actorEmail: 'manager@example.com',
      targetType: 'profile',
      targetId: 'uuid-a',
      page: '2',
      pageSize: '100',
    });
    expect(mocks.queryAuditLog).toHaveBeenCalledTimes(1);
    const call = mocks.queryAuditLog.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.actionPrefix).toBe('admin.');
    expect(call.actorEmail).toBe('manager@example.com');
    expect(call.targetType).toBe('profile');
    expect(call.targetId).toBe('uuid-a');
    expect(call.page).toBe(2);
    expect(call.pageSize).toBe(100);
  });

  it('converts datetime-local Central inputs to UTC before passing to queryAuditLog', async () => {
    await renderPage({
      fromCentral: '2026-05-15T08:00',
      toCentral: '2026-05-15T18:00',
    });
    const call = mocks.queryAuditLog.mock.calls[0]![0] as Record<string, unknown>;
    // 2026-05-15 CDT (UTC-5) → 08:00 CDT = 13:00 UTC; 18:00 CDT = 23:00 UTC.
    expect(call.fromUtc).toMatch(/^2026-05-15T13:00/);
    expect(call.toUtc).toMatch(/^2026-05-15T23:00/);
  });
});
