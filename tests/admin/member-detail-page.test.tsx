/**
 * Unit tests for `app/(admin)/admin/members/[id]/page.tsx` — the AC10
 * member-detail page (ADR-0035 WA.T6 / t7, updated by t14 for the
 * active typed-confirmation dialogs in AC18).
 *
 * Run locally:    pnpm test tests/admin/member-detail-page.test.tsx
 * Prerequisites:  none — pure module mocks (no DB, no network).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC10
 *       (five sections + actions panel + self-edit banner). AC18
 *       behavior is covered in tests/admin/member-detail-dialogs.test.tsx;
 *       this file asserts only the page-level contract.
 *
 * SUT contract (per AC10):
 *   - Server component. FIRST body statement is
 *     `const { profile: actor } = await requireRole('manager')`.
 *   - Five sections render: Profile (read-only <dl>), Membership,
 *     Time bank (via formatMoney — never raw cents), Recent activity
 *     (audit_log filtered to target_id = profile.id, last 20),
 *     Recent payments (Open Q 2 placeholder when payments table absent).
 *   - All timestamps render BOTH UTC and Central (ADR-0034).
 *   - Self-edit guard: when `actor.id === profile.id`, render the
 *     banner "You cannot perform admin actions against your own profile"
 *     AND hide the four action buttons (NOT just disable).
 *   - When NOT self-edit, the four action buttons render as an ACTIVE
 *     `ActionsPanel` client component (t14, AC18). Dialog interaction
 *     and typed-phrase gating live in
 *     `tests/admin/member-detail-dialogs.test.tsx`.
 *
 * Mocking strategy mirrors `tests/admin/dashboard-page.test.tsx`:
 *   - vi.mock('server-only')
 *   - vi.mock('next/navigation') for notFound + redirect
 *   - vi.mock('next/link') so happy-dom renders plain anchors
 *   - vi.mock('@/lib/auth/requireRole') — controls returned actor
 *   - vi.mock('@/lib/supabase/server') — fluent builder responding to
 *     `.from('profiles'|'memberships'|'time_wallets'|'audit_log'|'payments')`.
 *
 * The chain is awaitable (thenable). For chains that end in
 * `.maybeSingle()` the resolver returns `{ data, error }` directly;
 * for chains that end in `.order().limit()` the resolver returns
 * `{ data, error }` as well — `mocks.tableResolvers` is keyed by
 * table name and returns the same shape regardless of terminator.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen, within } from '@testing-library/react';

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

// `server-only` is a guard re-export. Neutralize so the SUT imports
// cleanly under vitest (mirrors the pattern in tests/auth/member-layout.test.ts).
vi.mock('server-only', () => ({}));

// `next/navigation` — the page calls `notFound()` when the profile row
// is missing. We make it throw a digest-tagged error so the page's
// `notFound()` call surfaces as a clean rejection in tests.
vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: vi.fn((p: string) => {
    const e = new Error(`NEXT_REDIRECT: ${p}`);
    (e as Error & { digest?: string }).digest = `NEXT_REDIRECT;${p}`;
    throw e;
  }),
}));

// `next/link` — happy-dom has no Next.js router context. A plain
// anchor that forwards children and props is sufficient for the
// tests; the page only uses Link for the breadcrumb-back link.
vi.mock('next/link', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- match Next's permissive Link prop signature in tests
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// `requireRole` — we drive this directly rather than its dependency
// chain, because the role-gate is covered exhaustively by
// tests/auth/admin-routes.test.ts. This test only cares that the
// detail page calls it with `'manager'`.
vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: mocks.requireRole,
}));

// `ActionsPanel` client component — keep the page-level test focused
// on the page's structural contract by stubbing the dialog component
// with a deterministic stand-in. The full dialog behavior is covered
// by tests/admin/member-detail-dialogs.test.tsx (t14, AC18).
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

// `lib/supabase/server` createClient — fluent-builder spy. Each
// "table" key in `mocks.tableResolvers` controls what the awaited
// chain resolves to. The chain shape mirrors the SUT:
//   profiles:     .from(...).select(...).eq(...).maybeSingle()
//   memberships:  .from(...).select(...).eq(...).maybeSingle()
//   time_wallets: .from(...).select(...).eq(...).maybeSingle()
//   audit_log:    .from(...).select(...).eq(...).order(...).limit(...)
//   payments:     .from(...).select(...).eq(...).order(...).limit(...)
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
      // .maybeSingle() returns a Promise of { data, error }.
      chain['maybeSingle'] = (): Promise<unknown> => Promise.resolve(resolveValue());
      chain['single'] = (): Promise<unknown> => Promise.resolve(resolveValue());
      // Allow the chain itself to be awaited (for .order().limit()).
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

// ---- Import AFTER vi.mock so the SUT picks up the stubs -------------------

// eslint-disable-next-line import/first
import MemberDetailPage from '@/app/(admin)/admin/members/[id]/page';

// ---- Test helpers ---------------------------------------------------------

const PAGE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'app',
  '(admin)',
  'admin',
  'members',
  '[id]',
  'page.tsx',
);

const ACTOR_ID = 'uuid-actor-manager';
const TARGET_ID = 'uuid-target-member';

const actorProfile = {
  id: ACTOR_ID,
  role: 'manager',
  full_name: 'Test Manager',
  email: 'manager@example.com',
};

// Minimal profile row that satisfies the SUT's <dl> rendering. The
// member_number, id_verified_at, and phone fields are nullable per
// the schema; the SUT renders "—" for absent values.
const targetProfileRow = {
  id: TARGET_ID,
  full_name: 'Jane Player',
  email: 'jane@example.com',
  member_number: 42,
  role: 'member',
  dob: '1990-05-15',
  phone: '+1 555 0100',
  created_at: '2026-05-15T14:32:08.000Z',
  id_verified_at: '2026-05-15T15:00:00.000Z',
};

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: actorProfile });
  mocks.notFound.mockClear();
  mocks.tableResolvers.clear();
  // Sensible defaults: profile exists, all other tables return no row.
  mocks.tableResolvers.set('profiles', { data: targetProfileRow, error: null });
  mocks.tableResolvers.set('memberships', { data: null, error: null });
  mocks.tableResolvers.set('time_wallets', { data: null, error: null });
  mocks.tableResolvers.set('audit_log', { data: [], error: null });
  mocks.tableResolvers.set('payments', { data: [], error: null });
});

async function renderPage(memberId = TARGET_ID): Promise<void> {
  const tree = await MemberDetailPage({ params: { id: memberId } });
  render(tree as React.ReactElement);
}

// ---- Tests ----------------------------------------------------------------

describe('member detail — requireRole gate', () => {
  it('calls requireRole("manager") as the first body statement', async () => {
    await renderPage();
    expect(mocks.requireRole).toHaveBeenCalledTimes(1);
    expect(mocks.requireRole).toHaveBeenCalledWith('manager');
  });

  it('calls notFound() when the profile row is missing', async () => {
    mocks.tableResolvers.set('profiles', { data: null, error: null });
    await expect(MemberDetailPage({ params: { id: 'no-such-id' } })).rejects.toThrow(
      /NEXT_NOT_FOUND/,
    );
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it('propagates an InsufficientRoleError thrown by requireRole', async () => {
    const err = new Error('InsufficientRoleError');
    err.name = 'InsufficientRoleError';
    mocks.requireRole.mockRejectedValueOnce(err);
    await expect(MemberDetailPage({ params: { id: TARGET_ID } })).rejects.toThrow(
      /InsufficientRoleError/,
    );
  });
});

describe('member detail — Section 1: Profile (<dl> read-only)', () => {
  it('renders all profile fields with the expected values', async () => {
    await renderPage();
    // "Jane Player" appears in both the page header (<h1>) and the
    // Profile <dl> — getAllByText is the correct assertion.
    expect(screen.getAllByText('Jane Player').length).toBeGreaterThan(0);
    expect(screen.getAllByText('jane@example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('#42')).toBeTruthy();
    // "member" (the role value) collides with the "Member number"
    // and "Membership" eyebrows on a substring match — scope to the
    // <dd> for the Role row specifically.
    const roleTerm = screen.getByText(/^Role$/i);
    const roleRow = roleTerm.parentElement;
    expect(roleRow).toBeTruthy();
    expect(roleRow!.textContent).toContain('member');
    expect(screen.getByText('1990-05-15')).toBeTruthy();
    expect(screen.getByText('+1 555 0100')).toBeTruthy();
  });

  it('renders created_at with BOTH UTC and Central timestamps (ADR-0034)', async () => {
    await renderPage();
    // 2026-05-15T14:32:08.000Z → UTC text contains "14:32:08 UTC" and
    // Central contains "09:32:08" with CDT (May 15 = DST in Chicago).
    expect(screen.getAllByText(/14:32:08\s+UTC/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/09:32:08\s+CDT/).length).toBeGreaterThan(0);
  });

  it('renders "—" when member_number is null', async () => {
    mocks.tableResolvers.set('profiles', {
      data: { ...targetProfileRow, member_number: null },
      error: null,
    });
    await renderPage();
    // Multiple "—" cells may render (phone null, etc.); the assertion
    // is that the Member number row receives the em-dash, not "#null".
    const memberNumberTerm = screen.getByText(/^Member number$/i);
    // The <dd> sibling lives in the same DRow grid. Walk up to the
    // enclosing DRow and assert it contains "—" and NOT "#null".
    const row = memberNumberTerm.parentElement;
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain('—');
    expect(row!.textContent).not.toContain('#null');
  });
});

describe('member detail — Section 2: Membership', () => {
  it('renders "No membership" when memberships row is null', async () => {
    await renderPage();
    expect(screen.getByText(/no membership/i)).toBeTruthy();
  });

  it('renders the joined membership data when present', async () => {
    mocks.tableResolvers.set('memberships', {
      data: {
        status: 'active',
        current_period_start: '2026-01-01T00:00:00.000Z',
        current_period_end: '2026-12-31T23:59:59.000Z',
      },
      error: null,
    });
    await renderPage();
    expect(screen.getByText('active')).toBeTruthy();
    // Period start timestamp renders UTC + Central.
    expect(
      screen.getAllByText(/2026-01-01\s+00:00:00\s+UTC/).length,
    ).toBeGreaterThan(0);
  });

  it('renders the Open-Q-3 placeholder when memberships table does not exist (42P01)', async () => {
    mocks.tableResolvers.set('memberships', {
      data: null,
      error: { code: '42P01', message: 'relation "memberships" does not exist' },
    });
    await renderPage();
    expect(screen.getByText(/Membership status pending — see ADR-0010\./i)).toBeTruthy();
  });
});

describe('member detail — Section 3: Time bank (via formatMoney)', () => {
  it('renders the balance formatted by formatMoney — NOT raw cents', async () => {
    mocks.tableResolvers.set('time_wallets', {
      data: { balance_cents: 12345 },
      error: null,
    });
    await renderPage();
    const balance = screen.getByTestId('time-bank-balance');
    // formatMoney(12345) → "$123.45" in en-US currency.
    expect(balance.textContent).toContain('$123.45');
    // Negative invariant: the raw integer 12345 must NOT appear
    // as the rendered balance text (it would only appear via raw
    // `${cents}` interpolation — exactly what ADR-0004 forbids).
    expect(balance.textContent).not.toBe('12345');
    expect(balance.textContent).not.toContain('12345');
  });

  it('renders "No wallet" when time_wallets row is null', async () => {
    await renderPage();
    expect(screen.getByText(/no wallet/i)).toBeTruthy();
  });

  it('renders the Open-Q-3 placeholder when time_wallets table does not exist', async () => {
    mocks.tableResolvers.set('time_wallets', {
      data: null,
      error: { code: '42P01', message: 'relation "time_wallets" does not exist' },
    });
    await renderPage();
    expect(screen.getByText(/Time bank pending — see ADR-0010\./i)).toBeTruthy();
  });
});

describe('member detail — Section 4: Recent activity (audit_log)', () => {
  it('renders an empty-state message when audit_log returns []', async () => {
    await renderPage();
    expect(screen.getByText(/no recent activity for this member/i)).toBeTruthy();
  });

  it('renders audit rows with UTC + Central timestamps', async () => {
    mocks.tableResolvers.set('audit_log', {
      data: [
        {
          id: 5,
          action: 'admin.member.role_changed',
          target_type: 'profile',
          target_id: TARGET_ID,
          created_at: '2026-05-15T18:00:00.000Z',
        },
        {
          id: 4,
          action: 'admin.verification.approved',
          target_type: 'profile',
          target_id: TARGET_ID,
          created_at: '2026-05-15T17:30:00.000Z',
        },
      ],
      error: null,
    });
    await renderPage();
    expect(screen.getByText('admin.member.role_changed')).toBeTruthy();
    expect(screen.getByText('admin.verification.approved')).toBeTruthy();
    // The most-recent row's UTC + Central pair must render.
    expect(screen.getAllByText(/18:00:00\s+UTC/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/13:00:00\s+CDT/).length).toBeGreaterThan(0);
  });
});

describe('member detail — Section 5: Recent payments', () => {
  it('renders the placeholder when payments table does not exist (Open Q 2)', async () => {
    mocks.tableResolvers.set('payments', {
      data: null,
      error: { code: '42P01', message: 'relation "payments" does not exist' },
    });
    await renderPage();
    expect(
      screen.getByText(/Payment integration pending — see ADR-0010 \/ 0036\./i),
    ).toBeTruthy();
  });

  it('renders "No recent payments." when the payments table exists but is empty', async () => {
    await renderPage();
    expect(screen.getByText(/no recent payments\./i)).toBeTruthy();
  });

  it('renders payment rows formatted via formatMoney when present', async () => {
    mocks.tableResolvers.set('payments', {
      data: [
        {
          id: 'pay-1',
          amount_cents: 5000,
          status: 'succeeded',
          created_at: '2026-05-15T19:00:00.000Z',
        },
      ],
      error: null,
    });
    await renderPage();
    expect(screen.getByText('$50.00')).toBeTruthy();
    expect(screen.getByText('succeeded')).toBeTruthy();
    expect(screen.getAllByText(/19:00:00\s+UTC/).length).toBeGreaterThan(0);
  });
});

describe('member detail — Actions panel (active dialogs — AC18)', () => {
  it('renders the ActionsPanel client component with all four action buttons', async () => {
    await renderPage();
    const panel = screen.getByTestId('actions-panel');
    // The four button labels are stable across t7→t14 — the page asserts
    // their presence; full dialog interaction is covered by
    // tests/admin/member-detail-dialogs.test.tsx.
    const labels = ['Change role', 'Request re-verification', 'Open refund flow', 'Initiate deletion'];
    for (const label of labels) {
      const button = within(panel).getByRole('button', { name: label });
      expect(button).toBeTruthy();
      // Buttons are ACTIVE in t14+ (no longer disabled). They open
      // the typed-confirmation dialog when clicked — see the dedicated
      // dialog test file for the interaction contract.
      expect((button as HTMLButtonElement).disabled).toBe(false);
    }
    // The self-edit banner is NOT present in the non-self-edit case.
    expect(screen.queryByTestId('self-edit-banner')).toBeNull();
  });

  it('passes profileId + memberEmail to the ActionsPanel client component', async () => {
    await renderPage();
    const panel = screen.getByTestId('actions-panel');
    // The stub renders the props as data-attributes so the page
    // contract (correct profile+email forwarded to the client wrapper)
    // can be asserted without mounting the full dialog component.
    expect(panel.getAttribute('data-profile-id')).toBe(TARGET_ID);
    expect(panel.getAttribute('data-member-email')).toBe('jane@example.com');
  });
});

describe('member detail — self-edit guard', () => {
  beforeEach(() => {
    // Actor is the same uuid as the target — triggers the self-edit guard.
    mocks.tableResolvers.set('profiles', {
      data: { ...targetProfileRow, id: ACTOR_ID },
      error: null,
    });
  });

  it('renders the self-edit banner when actor.id === profile.id', async () => {
    await renderPage(ACTOR_ID);
    const banner = screen.getByTestId('self-edit-banner');
    expect(banner.textContent).toContain(
      'You cannot perform admin actions against your own profile',
    );
  });

  it('HIDES the four action buttons when actor.id === profile.id (not just disabled)', async () => {
    await renderPage(ACTOR_ID);
    // The actions-panel container is replaced by the banner — neither
    // the panel nor any of the four buttons is present in the DOM.
    expect(screen.queryByTestId('actions-panel')).toBeNull();
    const labels = ['Change role', 'Request re-verification', 'Open refund flow', 'Initiate deletion'];
    for (const label of labels) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });
});

describe('member detail — source invariants (AC5 + AC10)', () => {
  it('first body statement is `await requireRole(\'manager\')` (AC5 defense-in-depth)', () => {
    // Mirrors the walker in tests/auth/admin-routes-defense-in-depth.test.ts —
    // catches a refactor that splits the page into multiple statements
    // and slips a DB read before the gate.
    const src = readFileSync(PAGE_PATH, 'utf8');
    const exportMatch = src.match(
      /export\s+default\s+async\s+function\s+\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/,
    );
    expect(exportMatch).toBeTruthy();
    const bodyStart = exportMatch!.index! + exportMatch![0].length;
    let i = bodyStart;
    const advancePastTrivia = (): void => {
      while (i < src.length) {
        if (/\s/.test(src[i]!)) {
          i += 1;
          continue;
        }
        if (src.slice(i, i + 2) === '//') {
          const eol = src.indexOf('\n', i);
          i = eol === -1 ? src.length : eol + 1;
          continue;
        }
        if (src.slice(i, i + 2) === '/*') {
          const end = src.indexOf('*/', i + 2);
          i = end === -1 ? src.length : end + 2;
          continue;
        }
        break;
      }
    };
    advancePastTrivia();
    const firstStmt = src.slice(i, i + 120);
    expect(firstStmt).toMatch(
      /^(?:const\s*\{[^}]+\}\s*=\s*)?await\s+requireRole\(\s*['"]manager['"]\s*\)/,
    );
  });

  it('imports `requireRole` from `@/lib/auth/requireRole`', () => {
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).toMatch(
      /import\s*\{\s*requireRole\s*\}\s*from\s*['"]@\/lib\/auth\/requireRole['"]/,
    );
  });

  it('imports `formatMoney` from `@/lib/money/types` (ADR-0004 — never raw cents)', () => {
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).toMatch(/import[^;]*\bformatMoney\b[^;]*from\s*['"]@\/lib\/money\/types['"]/);
  });

  it('uses cookie-scoped `createClient()` from `@/lib/supabase/server` (R1 mitigation)', () => {
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).toMatch(/from\s*['"]@\/lib\/supabase\/server['"]/);
    expect(src).not.toMatch(/from\s*['"]@\/lib\/supabase\/admin['"]/);
  });

  it('source does NOT contain `\'use client\'` (server-component-only)', () => {
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).not.toContain("'use client'");
    expect(src).not.toContain('"use client"');
  });
});
