/**
 * Tests for the Slice 4D session-level audit-event emissions wired into
 * `lib/auth/requireRole.ts` (ADR-0035 AC31 + AC34, t17).
 *
 * Run locally:    pnpm test tests/admin/session-and-flow-audit-events.test.ts
 * Prerequisites:  none — pure module mocks.
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC31
 *       (session-level + flow-level audit events) + AC34 (the wiring task).
 *
 * Contract under test:
 *   - `admin.session.entered` fires on the FIRST successful manager+
 *     role check per browser session (mock cookie absent). The hook
 *     uses the cookie-scoped supabase client for the INSERT — the
 *     authenticated session has `auth.uid() IS NOT NULL` so the
 *     audit_log_insert_authenticated policy is satisfied.
 *   - `admin.session.entered` does NOT fire on subsequent calls when
 *     the `mopc-admin-session-seen` cookie is present (30-min TTL
 *     dedup). The hook short-circuits before issuing the INSERT.
 *   - `admin.session.role_check_denied` fires when `InsufficientRoleError`
 *     is thrown for a manager+ required minimum AND the request path
 *     begins with `/admin/`. The hook uses the SERVICE-ROLE client
 *     because the denied session may not have INSERT privileges on
 *     audit_log.
 *   - `admin.refund.flow_opened` source-grep — pinned to the t14
 *     action's source file so a future refactor that drops the
 *     audit-action string is caught by this cross-cutting test too.
 *
 * Why both the session test AND the flow source-grep live here:
 *   - The taxonomy in ADR-0035 §AC27 names the four Slice-4D events
 *     as a single group; this test file is the consolidated forensic
 *     guarantee that all four event names ship and behave per spec.
 *   - The flow source-grep is a defense-in-depth check on top of
 *     `tests/admin/open-refund-flow-action.test.ts` (which already
 *     pins the same string); the redundancy is intentional — both
 *     tests must pass for the audit-event contract to hold.
 *
 * Mock surface mirrors `tests/auth/requireRole.test.ts` so the SUT
 * picks up the same `next/navigation`, `next/headers`, and
 * `./getCurrentProfile` shapes. The additions here:
 *   - vi.mock('next/headers', { headers, cookies }) — cookies() is
 *     consumed by the success-path hook for the dedup-cookie read +
 *     write. Tests program the cookie store per-case.
 *   - vi.mock('@/lib/supabase/server', { createClient }) — the
 *     success-path INSERT goes through the cookie-scoped client.
 *   - vi.mock('@/lib/supabase/admin', { createAdminClient }) — the
 *     denied-path INSERT goes through the service-role client.
 *   - Both supabase mocks return a tiny chainable shim with `.from(...)
 *     .insert(...)` so the test can assert the row shape passed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const mocks = vi.hoisted(() => {
  return {
    getCurrentProfile: vi.fn(),
    getSessionAal: vi.fn<() => Promise<'aal1' | 'aal2'>>(),
    redirect: vi.fn((target: string) => {
      const err = new Error(`NEXT_REDIRECT: ${target}`);
      err.name = 'RedirectError';
      (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;${target}`;
      throw err;
    }),
    headersGet: vi.fn<(name: string) => string | null>(),
    cookieGet: vi.fn<(name: string) => { value: string } | undefined>(),
    cookieSet: vi.fn(),
    // Captured supabase INSERT calls — keyed by client kind so tests
    // can assert which client wrote which row.
    cookieClientInserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
    serviceClientInserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
    // Toggle to simulate INSERT failures (the hook must swallow them).
    cookieClientInsertError: null as null | { message: string },
    serviceClientInsertError: null as null | { message: string },
    mfaState: { ready: false as boolean },
  };
});

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

vi.mock('next/headers', () => ({
  headers: async () => ({ get: mocks.headersGet }),
  cookies: async () => ({
    get: mocks.cookieGet,
    set: mocks.cookieSet,
  }),
}));

vi.mock('./getCurrentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));
vi.mock('@/lib/auth/getCurrentProfile', () => ({
  getCurrentProfile: mocks.getCurrentProfile,
}));

vi.mock('./getSessionAal', () => ({
  getSessionAal: mocks.getSessionAal,
}));
vi.mock('@/lib/auth/getSessionAal', () => ({
  getSessionAal: mocks.getSessionAal,
}));

vi.mock('./mfa-availability', () => ({
  get MFA_CHALLENGE_READY() {
    return mocks.mfaState.ready;
  },
}));
vi.mock('@/lib/auth/mfa-availability', () => ({
  get MFA_CHALLENGE_READY() {
    return mocks.mfaState.ready;
  },
}));

// Cookie-scoped supabase client mock. Records every `.from(table)
// .insert(row)` call for assertion + returns the configured
// success/error shape.
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        mocks.cookieClientInserts.push({ table, row });
        return Promise.resolve({ error: mocks.cookieClientInsertError });
      },
    }),
  }),
}));

// Service-role supabase client mock — separate inserts queue so tests
// can pin which path used which client.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        mocks.serviceClientInserts.push({ table, row });
        return Promise.resolve({ error: mocks.serviceClientInsertError });
      },
    }),
  }),
}));

// Imports AFTER vi.mock so the SUT picks up the mocked modules.
// eslint-disable-next-line import/first
import { requireRole, type Role } from '@/lib/auth/requireRole';
// eslint-disable-next-line import/first
import { InsufficientRoleError } from '@/lib/auth/errors';

type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
};
const makeProfile = (role: Role, overrides: Partial<Profile> = {}): Profile => ({
  id: 'uuid-test-actor',
  full_name: 'Test User',
  email: 'test@example.com',
  role,
  ...overrides,
});

const setHeaders = (entries: Record<string, string>) => {
  mocks.headersGet.mockImplementation((name: string) => entries[name] ?? null);
};

const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const REFUND_ACTION_PATH = resolve(
  TEST_DIR,
  '..',
  '..',
  'app',
  '(admin)',
  'admin',
  'members',
  '[id]',
  '_actions',
  'openRefundFlow.ts',
);

beforeEach(() => {
  mocks.redirect.mockClear();
  mocks.getCurrentProfile.mockReset();
  mocks.getSessionAal.mockReset();
  mocks.headersGet.mockReset();
  mocks.headersGet.mockImplementation(() => null);
  mocks.cookieGet.mockReset();
  mocks.cookieGet.mockImplementation(() => undefined);
  mocks.cookieSet.mockReset();
  mocks.cookieClientInserts.length = 0;
  mocks.serviceClientInserts.length = 0;
  mocks.cookieClientInsertError = null;
  mocks.serviceClientInsertError = null;
  mocks.mfaState.ready = false;
});

// =============================================================================
// admin.session.entered — fires on FIRST successful role check per session
// =============================================================================
describe('admin.session.entered — fires on first successful manager+ role check per tab', () => {
  it('manager required + aal2 + cookie absent → emits row via cookie-scoped client, sets dedup cookie', async () => {
    const profile = makeProfile('manager');
    mocks.getCurrentProfile.mockResolvedValueOnce(profile);
    mocks.getSessionAal.mockResolvedValueOnce('aal2');
    mocks.cookieGet.mockReturnValueOnce(undefined); // first entry — no cookie

    const result = await requireRole('manager');

    expect(result).toEqual({ profile });

    // The hook is fire-and-forget (void); give the microtask queue
    // one tick so the audit INSERT promise resolves before we assert.
    await new Promise((r) => setImmediate(r));

    // Cookie-scoped client received the INSERT (NOT the service-role
    // client — the manager has an authenticated session that satisfies
    // audit_log_insert_authenticated).
    expect(mocks.cookieClientInserts).toHaveLength(1);
    expect(mocks.serviceClientInserts).toHaveLength(0);

    const insertCall = mocks.cookieClientInserts[0]!;
    expect(insertCall.table).toBe('audit_log');
    expect(insertCall.row).toMatchObject({
      actor_id: profile.id,
      action: 'admin.session.entered',
      target_type: 'session',
      target_id: profile.id,
      before: null,
      after: null,
    });

    // Dedup cookie was set with the 30-min TTL named in the SUT.
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      'mopc-admin-session-seen',
      '1',
      expect.objectContaining({
        maxAge: 60 * 30,
        path: '/',
        sameSite: 'lax',
        httpOnly: true,
      }),
    );
  });

  it('owner required + aal2 + cookie absent → emits row (manager+ AND owner+ both gated)', async () => {
    const profile = makeProfile('owner');
    mocks.getCurrentProfile.mockResolvedValueOnce(profile);
    mocks.getSessionAal.mockResolvedValueOnce('aal2');
    mocks.cookieGet.mockReturnValueOnce(undefined);

    await requireRole('owner');
    await new Promise((r) => setImmediate(r));

    expect(mocks.cookieClientInserts).toHaveLength(1);
    expect(mocks.cookieClientInserts[0]!.row).toMatchObject({
      action: 'admin.session.entered',
      actor_id: profile.id,
    });
  });
});

// =============================================================================
// admin.session.entered — NOT emitted on subsequent calls (cookie dedup)
// =============================================================================
describe('admin.session.entered — does NOT fire when dedup cookie present', () => {
  it('manager required + aal2 + cookie present → no audit row written, no cookie re-set', async () => {
    const profile = makeProfile('manager');
    mocks.getCurrentProfile.mockResolvedValueOnce(profile);
    mocks.getSessionAal.mockResolvedValueOnce('aal2');
    mocks.cookieGet.mockReturnValueOnce({ value: '1' }); // dedup cookie present

    const result = await requireRole('manager');
    expect(result).toEqual({ profile });

    await new Promise((r) => setImmediate(r));

    // NO INSERT — the hook short-circuits when the cookie is present.
    expect(mocks.cookieClientInserts).toHaveLength(0);
    expect(mocks.serviceClientInserts).toHaveLength(0);

    // cookies.set is NOT called either — we don't refresh the TTL
    // on every subsequent call (would defeat the 30-min dedup
    // window). The next entry after TTL-expiry will re-emit.
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it('owner required + aal2 + cookie present → no audit row', async () => {
    const profile = makeProfile('owner');
    mocks.getCurrentProfile.mockResolvedValueOnce(profile);
    mocks.getSessionAal.mockResolvedValueOnce('aal2');
    mocks.cookieGet.mockReturnValueOnce({ value: '1' });

    await requireRole('owner');
    await new Promise((r) => setImmediate(r));

    expect(mocks.cookieClientInserts).toHaveLength(0);
    expect(mocks.serviceClientInserts).toHaveLength(0);
  });
});

// =============================================================================
// admin.session.role_check_denied — fires on InsufficientRoleError for /admin/**
// =============================================================================
describe('admin.session.role_check_denied — fires on /admin/** denial', () => {
  it('member required=manager + x-pathname=/admin → emits role_check_denied via SERVICE-ROLE client', async () => {
    expect.assertions(5);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('member', { id: 'uuid-member-1' }));
    setHeaders({ 'x-pathname': '/admin' });

    let caught: unknown;
    try {
      await requireRole('manager');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(InsufficientRoleError);

    // Give the fire-and-forget hook one microtask tick to complete.
    await new Promise((r) => setImmediate(r));

    // SERVICE-ROLE client received the INSERT — the denied session
    // may not have INSERT privileges on audit_log (a member role
    // cannot write audit rows under the service-role posture), so
    // the BYPASSRLS service-role client is the canonical writer.
    expect(mocks.serviceClientInserts).toHaveLength(1);
    expect(mocks.cookieClientInserts).toHaveLength(0);

    const insertCall = mocks.serviceClientInserts[0]!;
    expect(insertCall.row).toMatchObject({
      actor_id: 'uuid-member-1',
      action: 'admin.session.role_check_denied',
      target_type: 'session',
      target_id: 'uuid-member-1',
      before: null,
    });
    // `after` records the structural denial details — role names are
    // NOT PII (AC28 redaction list is email/full_name/phone/dob).
    expect(insertCall.row['after']).toMatchObject({
      required: 'manager',
      actual: 'member',
      path: '/admin',
    });
  });

  it('cashier required=manager + x-pathname=/admin/members/abc → emits role_check_denied', async () => {
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce(
      makeProfile('cashier', { id: 'uuid-cashier-1' }),
    );
    setHeaders({ 'x-pathname': '/admin/members/abc' });

    let caught: unknown;
    try {
      await requireRole('manager');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InsufficientRoleError);

    await new Promise((r) => setImmediate(r));

    expect(mocks.serviceClientInserts).toHaveLength(1);
    expect(mocks.serviceClientInserts[0]!.row).toMatchObject({
      action: 'admin.session.role_check_denied',
      actor_id: 'uuid-cashier-1',
    });
  });

  it('manager required=owner + x-pathname=/admin → emits role_check_denied (owner-only gate too)', async () => {
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('manager', { id: 'uuid-mgr-1' }));
    setHeaders({ 'x-pathname': '/admin' });

    let caught: unknown;
    try {
      await requireRole('owner');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InsufficientRoleError);

    await new Promise((r) => setImmediate(r));

    expect(mocks.serviceClientInserts).toHaveLength(1);
    expect(mocks.serviceClientInserts[0]!.row).toMatchObject({
      action: 'admin.session.role_check_denied',
    });
  });
});

// =============================================================================
// admin.session.role_check_denied — path scoping (only /admin/** emits)
// =============================================================================
describe('admin.session.role_check_denied — path scoping', () => {
  it('member required=manager + x-pathname=/portal → InsufficientRoleError thrown, NO audit row', async () => {
    // Path scope: the role_check_denied event is named for the admin
    // console denial channel. A lower-rank caller failing a manager+
    // gate on a non-admin surface (e.g. a hypothetical owner-only
    // settings panel on the portal) is NOT an admin-console denial
    // event. The hook gates on path.startsWith('/admin').
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('member'));
    setHeaders({ 'x-pathname': '/portal/profile' });

    let caught: unknown;
    try {
      await requireRole('manager');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InsufficientRoleError);

    await new Promise((r) => setImmediate(r));

    // No audit row from either client.
    expect(mocks.serviceClientInserts).toHaveLength(0);
    expect(mocks.cookieClientInserts).toHaveLength(0);
  });

  it('member required=cashier + x-pathname=/admin → InsufficientRoleError thrown, NO audit row (member|cashier required minimums never fire)', async () => {
    // The hook only fires for manager|owner required minimums (the
    // AAL2_REQUIRED_ROLES set). A cashier-required gate on /admin
    // would be unusual but the event is scoped to admin-console
    // denials specifically — the cashier ladder is below that band.
    expect.assertions(3);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('member'));
    setHeaders({ 'x-pathname': '/admin' });

    let caught: unknown;
    try {
      await requireRole('cashier');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InsufficientRoleError);

    await new Promise((r) => setImmediate(r));

    expect(mocks.serviceClientInserts).toHaveLength(0);
    expect(mocks.cookieClientInserts).toHaveLength(0);
  });
});

// =============================================================================
// admin.refund.flow_opened — source-grep (t14 already covers behavior)
// =============================================================================
describe('admin.refund.flow_opened — source contains the audit-action string', () => {
  it('openRefundFlow.ts source matches /admin\\.refund\\.flow_opened/', () => {
    const src = readFileSync(REFUND_ACTION_PATH, 'utf8');
    expect(src).toMatch(/admin\.refund\.flow_opened/);
  });
});

// =============================================================================
// Graceful degradation — hook errors MUST NOT break the security boundary
// =============================================================================
describe('audit hooks — errors are swallowed (security boundary unaffected)', () => {
  it('admin.session.entered: cookie-client INSERT error → role check still returns profile', async () => {
    const profile = makeProfile('manager');
    mocks.getCurrentProfile.mockResolvedValueOnce(profile);
    mocks.getSessionAal.mockResolvedValueOnce('aal2');
    mocks.cookieGet.mockReturnValueOnce(undefined);
    mocks.cookieClientInsertError = { message: 'simulated DB outage' };

    // Despite the INSERT failure, requireRole MUST return cleanly —
    // the audit emission is forensic add-on, not the security boundary.
    const result = await requireRole('manager');
    expect(result).toEqual({ profile });

    await new Promise((r) => setImmediate(r));

    // The hook tried to write (so we see one entry) — the error was
    // swallowed by the try/catch in the hook body.
    expect(mocks.cookieClientInserts).toHaveLength(1);
  });

  it('admin.session.role_check_denied: service-role INSERT error → InsufficientRoleError still thrown', async () => {
    expect.assertions(2);
    mocks.getCurrentProfile.mockResolvedValueOnce(makeProfile('member'));
    setHeaders({ 'x-pathname': '/admin' });
    mocks.serviceClientInsertError = { message: 'simulated service-role outage' };

    let caught: unknown;
    try {
      await requireRole('manager');
    } catch (e) {
      caught = e;
    }
    // The security throw is unaffected by the hook's INSERT failure.
    expect(caught).toBeInstanceOf(InsufficientRoleError);

    await new Promise((r) => setImmediate(r));

    // The hook tried to write — the error was swallowed.
    expect(mocks.serviceClientInserts).toHaveLength(1);
  });
});
