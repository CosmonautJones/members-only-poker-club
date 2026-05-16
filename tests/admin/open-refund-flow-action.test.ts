/**
 * Tests for `app/(admin)/admin/members/[id]/_actions/openRefundFlow.ts`
 * — the AC17 / WC.T14 refund-flow breadcrumb action.
 *
 * Run locally:    pnpm test tests/admin/open-refund-flow-action.test.ts
 * Prerequisites:  none — @electric-sql/pglite (in-process WASM Postgres).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC17
 *       (audit breadcrumb fires in BOTH PAYMENTS_CONSOLE_READY branches;
 *       degraded redirect when false; no mutation; premortem R9 input
 *       validation rejects malformed UUID + nonexistent profile with
 *       NO audit row).
 *
 * SUT contract:
 *   - First runtime statement is `await requireRole('manager');`.
 *   - Premortem R9: validate UUID shape AND existence BEFORE the audit-tx;
 *     reject with `BadRequest` (no audit row written for rejected calls).
 *   - Inside `withAudit('admin.refund.flow_opened', 'profile', profileId)`:
 *     `before = null`, `after = { scope }`. NO SQL UPDATE.
 *   - Returns `{ redirectTo }`:
 *       * PAYMENTS_CONSOLE_READY === true  → '/admin/payments/[id]/refund'
 *       * PAYMENTS_CONSOLE_READY === false → '/admin/members/[id]?refund=pending-adr-0036'
 *   - Audit row fires in BOTH cases.
 *
 * Mirrors the pglite-DI pattern from
 * `tests/admin/change-role-action.test.ts` + `request-reverification-action.test.ts`.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

vi.mock('server-only', () => ({}));

// requireRole mock — mirrors change-role-action.test.ts.
const requireRoleState = vi.hoisted(() => ({
  currentActor: null as { id: string; role: 'cashier' | 'manager' | 'owner' } | null,
}));

vi.mock('@/lib/auth/requireRole', async () => {
  const { InsufficientRoleError } = await vi.importActual<
    typeof import('@/lib/auth/errors')
  >('@/lib/auth/errors');
  return {
    requireRole: vi.fn(async (required: 'manager' | 'owner') => {
      const actor = requireRoleState.currentActor;
      if (!actor) {
        throw new Error('test bug: currentActor not set before requireRole call');
      }
      const rank: Record<string, number> = {
        member: 0,
        cashier: 1,
        manager: 2,
        owner: 3,
      };
      if (rank[actor.role]! < rank[required]!) {
        throw new InsufficientRoleError(required, actor.role);
      }
      return { profile: { id: actor.id, role: actor.role } };
    }),
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('test bug: defaultDb() reached — tests must inject db param');
  },
}));

// `next/cache` — pass-through mock so the action's post-tx
// revalidateTag('admin-dashboard-counts') call (added by t21 to satisfy
// the AC35 dashboard-cache-invalidation source-grep) does not blow up
// in the vitest environment. The action wraps the call in try/catch so
// even a thrown mock would be tolerated; we provide a no-op spy here
// for clarity.
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

// `lib/payments/console-availability` — controllable mock. The default
// per Q4 is `false` (degraded redirect); the canonical-path test
// overrides to `true` via `vi.doMock` + a re-import.
vi.mock('@/lib/payments/console-availability', () => ({
  PAYMENTS_CONSOLE_READY: false,
}));

// eslint-disable-next-line import/first
import {
  openRefundFlow,
  type TransactionRunner,
} from '@/app/(admin)/admin/members/[id]/_actions/openRefundFlow';
// eslint-disable-next-line import/first
import { BadRequest } from '@/app/(admin)/admin/_errors';
// eslint-disable-next-line import/first
import { InsufficientRoleError } from '@/lib/auth/errors';
// eslint-disable-next-line import/first
import { setupAuthStub, resetAuthStub, setTestUid } from '../db/_fixtures/auth-stub';
// eslint-disable-next-line import/first
import { seedProfile } from '../db/_fixtures/profiles';
// eslint-disable-next-line import/first
import {
  setupAppAuthenticatedRole,
  asAuthenticated,
  asServiceRole,
} from '../db/_fixtures/rls-helpers';

const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const MIG_0002 = resolve(
  TEST_DIR,
  '..',
  '..',
  'supabase',
  'migrations',
  '0002_profiles_and_roles.sql',
);
const MIG_0003 = resolve(TEST_DIR, '..', '..', 'supabase', 'migrations', '0003_audit_log.sql');
const ACTION_PATH = resolve(
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

let pg: PGlite;
let manager1: string;
let cashier1: string;
let target1: string;

interface PgliteTxLike {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

function pgliteRunner(p: PGlite): TransactionRunner {
  return {
    transaction: async (callback) => {
      return p.transaction(async (tx: PgliteTxLike) => {
        return callback({
          query: async (sql, params) => {
            const r = await tx.query(sql, params);
            return { rows: r.rows as unknown[] };
          },
        });
      });
    },
  };
}

async function runSqlBlock(sql: string): Promise<void> {
  const runner = (pg as unknown as { exec: (s: string) => Promise<unknown> }).exec;
  await runner.call(pg, sql);
}

beforeAll(async () => {
  pg = new PGlite();
  await setupAuthStub(pg);
  await runSqlBlock(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `);
  await runSqlBlock(readFileSync(MIG_0002, 'utf8'));
  await runSqlBlock(readFileSync(MIG_0003, 'utf8'));

  const seedAs = async (
    role: 'member' | 'cashier' | 'manager',
    label: string,
  ): Promise<string> => {
    const u = await pg.query<{ id: string }>(
      'INSERT INTO auth.users DEFAULT VALUES RETURNING id',
    );
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@open-refund-test.local`,
    });
    return profile.id;
  };

  manager1 = await seedAs('manager', 'manager1');
  cashier1 = await seedAs('cashier', 'cashier1');
  target1 = await seedAs('member', 'target1');

  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'audit_log'],
    sequences: ['audit_log_id_seq'],
  });
});

afterAll(async () => {
  await pg?.close?.();
});

beforeEach(async () => {
  await resetAuthStub(pg);
  requireRoleState.currentActor = null;
  await asServiceRole(pg);
  await pg.query('TRUNCATE TABLE audit_log RESTART IDENTITY');
});

async function readAuditRows(targetId: string): Promise<
  Array<{ action: string; actor_id: string | null; before: unknown; after: unknown }>
> {
  await asServiceRole(pg);
  const result = await pg.query<{
    action: string;
    actor_id: string | null;
    before: unknown;
    after: unknown;
  }>(
    `SELECT action, actor_id::text AS actor_id, before, after
       FROM audit_log
      WHERE target_type = 'profile' AND target_id = $1
      ORDER BY id ASC`,
    [targetId],
  );
  return result.rows;
}

// =============================================================================
// AC17.1 — Happy path: degraded redirect when PAYMENTS_CONSOLE_READY=false
// =============================================================================
describe('openRefundFlow — AC17 happy path (PAYMENTS_CONSOLE_READY=false)', () => {
  it('writes 1 audit row + returns degraded redirect target', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const result = await openRefundFlow(
      { profileId: target1, scope: 'membership' },
      pgliteRunner(pg),
    );

    // Degraded redirect target — see AC17 + lib/payments/console-availability.ts
    expect(result.redirectTo).toBe(
      `/admin/members/${target1}?refund=pending-adr-0036`,
    );

    // Exactly one audit row — admin.refund.flow_opened. NO mutation
    // means no trigger-emitted row.
    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.refund.flow_opened');
    expect(rows[0]!.actor_id).toBe(manager1);
    expect(rows[0]!.before).toBeNull();
    expect(rows[0]!.after).toEqual({ scope: 'membership' });
  });

  it('captures the chosen scope in audit after for time_bank', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await openRefundFlow(
      { profileId: target1, scope: 'time_bank' },
      pgliteRunner(pg),
    );

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after).toEqual({ scope: 'time_bank' });
  });

  it('captures the chosen scope in audit after for tournament_entry', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await openRefundFlow(
      { profileId: target1, scope: 'tournament_entry' },
      pgliteRunner(pg),
    );

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after).toEqual({ scope: 'tournament_entry' });
  });
});

// =============================================================================
// AC17.2 — Canonical redirect when PAYMENTS_CONSOLE_READY=true
// =============================================================================
describe('openRefundFlow — AC17 canonical redirect (PAYMENTS_CONSOLE_READY=true)', () => {
  it('returns /admin/payments/[id]/refund when constant is flipped to true', async () => {
    // The default vi.mock above pins PAYMENTS_CONSOLE_READY=false. We
    // re-mock the module to true and re-import the action module so
    // the constant binding refreshes. vi.resetModules() is required
    // because module-level imports are cached across tests.
    vi.resetModules();
    vi.doMock('@/lib/payments/console-availability', () => ({
      PAYMENTS_CONSOLE_READY: true,
    }));
    // Re-mock auth + admin client + server-only after reset.
    vi.doMock('server-only', () => ({}));
    vi.doMock('@/lib/auth/requireRole', async () => {
      const { InsufficientRoleError } = await vi.importActual<
        typeof import('@/lib/auth/errors')
      >('@/lib/auth/errors');
      return {
        requireRole: vi.fn(async (required: 'manager' | 'owner') => {
          const actor = requireRoleState.currentActor;
          if (!actor) throw new Error('test bug: no actor');
          const rank: Record<string, number> = {
            member: 0,
            cashier: 1,
            manager: 2,
            owner: 3,
          };
          if (rank[actor.role]! < rank[required]!) {
            throw new InsufficientRoleError(required, actor.role);
          }
          return { profile: { id: actor.id, role: actor.role } };
        }),
      };
    });
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => {
        throw new Error('test bug: defaultDb() reached');
      },
    }));

    const reImported = await import(
      '@/app/(admin)/admin/members/[id]/_actions/openRefundFlow'
    );
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const result = await reImported.openRefundFlow(
      { profileId: target1, scope: 'membership' },
      pgliteRunner(pg),
    );
    expect(result.redirectTo).toBe(`/admin/payments/${target1}/refund`);

    // Audit row still fires in the canonical-redirect branch (AC17:
    // "the audit row fires in BOTH cases").
    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.refund.flow_opened');

    // Restore the false-state mock for subsequent tests in this file.
    vi.doUnmock('@/lib/payments/console-availability');
    vi.resetModules();
  });
});

// =============================================================================
// AC17.3 — Manager+ required: cashier session throws InsufficientRoleError
// =============================================================================
describe('openRefundFlow — AC17 manager+ required', () => {
  it('cashier session throws InsufficientRoleError; no audit row', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: cashier1, role: 'cashier' };
    await setTestUid(pg, cashier1);
    await asAuthenticated(pg, cashier1);

    await expect(
      openRefundFlow(
        { profileId: target1, scope: 'membership' },
        pgliteRunner(pg),
      ),
    ).rejects.toBeInstanceOf(InsufficientRoleError);

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC17.4 — Premortem R9: malformed UUID rejected with BadRequest, no audit
// =============================================================================
describe('openRefundFlow — premortem R9 malformed UUID', () => {
  it("rejects profileId='not-a-uuid' with BadRequest and writes NO audit row", async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      openRefundFlow(
        { profileId: 'not-a-uuid', scope: 'membership' },
        pgliteRunner(pg),
      ),
    ).rejects.toBeInstanceOf(BadRequest);

    // The audit_log table-wide check — no row was written for any
    // target_id (the rejected attempt should never reach withAudit).
    await asServiceRole(pg);
    const all = await pg.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM audit_log');
    expect(all.rows[0]!.count).toBe('0');
  });

  it('rejects empty-string profileId with BadRequest', async () => {
    expect.assertions(1);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      openRefundFlow(
        { profileId: '', scope: 'membership' },
        pgliteRunner(pg),
      ),
    ).rejects.toBeInstanceOf(BadRequest);
  });

  it('rejects malformed scope with BadRequest, no audit row', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      openRefundFlow(
        // @ts-expect-error — intentional misuse for the test
        { profileId: target1, scope: 'not-a-scope' },
        pgliteRunner(pg),
      ),
    ).rejects.toBeInstanceOf(BadRequest);

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC17.5 — Premortem R9: nonexistent (well-formed) UUID rejected, no audit
// =============================================================================
describe('openRefundFlow — premortem R9 nonexistent profile', () => {
  it("rejects well-formed but nonexistent profileId with BadRequest, no audit", async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    // Well-formed v4 UUID that does not exist in the profiles table.
    const ghostId = '00000000-0000-4000-8000-000000000000';

    await expect(
      openRefundFlow(
        { profileId: ghostId, scope: 'membership' },
        pgliteRunner(pg),
      ),
    ).rejects.toBeInstanceOf(BadRequest);

    // The audit_log table-wide check — no row was written for the
    // ghost id (the existence-probe rejected BEFORE the audit-tx).
    const rows = await readAuditRows(ghostId);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC17.6 — No mutation: profile row unchanged after openRefundFlow
// =============================================================================
describe('openRefundFlow — AC17 no mutation', () => {
  it('does NOT modify any profile column', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await asServiceRole(pg);
    const before = await pg.query<{
      role: string;
      full_name: string;
      email: string;
    }>('SELECT role, full_name, email FROM profiles WHERE id = $1', [target1]);
    expect(before.rows[0]).toBeDefined();

    await openRefundFlow(
      { profileId: target1, scope: 'membership' },
      pgliteRunner(pg),
    );

    await asServiceRole(pg);
    const after = await pg.query<{
      role: string;
      full_name: string;
      email: string;
    }>('SELECT role, full_name, email FROM profiles WHERE id = $1', [target1]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

// =============================================================================
// Source-shape invariants (AC5, AC17)
// =============================================================================
describe('openRefundFlow — source-shape invariants', () => {
  it("first line is `import 'server-only';`", () => {
    const src = readFileSync(ACTION_PATH, 'utf8').replace(/^﻿/, '');
    const firstLine = src.split(/\r?\n/)[0]!.trim();
    expect(firstLine).toBe("import 'server-only';");
  });

  it("contains the literal `await requireRole('manager')` call", () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/await\s+requireRole\(\s*['"]manager['"]\s*\)/);
  });

  it('contains the literal `admin.refund.flow_opened` audit-action string', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/admin\.refund\.flow_opened/);
  });

  it('imports PAYMENTS_CONSOLE_READY from @/lib/payments/console-availability', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(
      /import[^;]*\bPAYMENTS_CONSOLE_READY\b[^;]*from\s*['"]@\/lib\/payments\/console-availability['"]/,
    );
  });

  it('source does NOT contain any UPDATE / INSERT statement against non-audit tables', () => {
    // The action MUST NOT mutate state (AC17). Strip comments first so
    // JSDoc mentions of "UPDATE" don't false-positive the grep.
    const src = readFileSync(ACTION_PATH, 'utf8');
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/UPDATE\s+profiles\b/i);
    expect(stripped).not.toMatch(/INSERT\s+INTO\s+(?!audit_log)\w+/i);
  });
});
