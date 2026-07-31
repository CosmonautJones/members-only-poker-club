/**
 * Tests for `app/(admin)/admin/verifications/_actions/approveVerification.ts`
 * — the AC12 / WB.T8 verification-approval server action.
 *
 * Run locally:    pnpm test tests/admin/approve-verification-action.test.ts
 * Prerequisites:  none — @electric-sql/pglite (in-process WASM Postgres).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC12
 *       (stamps id_verified_at + assigns member_number via
 *       nextval('member_number_seq'); idempotent no-op when already
 *       verified; before/after audit shape carries ONLY timestamps +
 *       member_number, NO PII; revalidateTag post-tx).
 *
 * SUT contract (per AC12):
 *   - First runtime statement is `await requireRole('manager');` (outer gate).
 *   - Self-edit guard throws `SelfEditViolation` BEFORE the audit tx opens.
 *   - Inside withAudit('admin.verification.approved', 'profile'):
 *     SELECT id_verified_at, member_number FOR UPDATE → before (or no-op
 *     branch if already verified);
 *     UPDATE id_verified_at = now(), member_number = nextval(...);
 *     SELECT → after.
 *   - Idempotent no-op when id_verified_at IS NOT NULL — returns
 *     existing memberNumber, NO audit row written.
 *   - before/after carry ONLY {id_verified_at, member_number} — NO PII.
 *   - Post-tx revalidateTag('admin-dashboard-counts') (best-effort).
 *
 * Test substrate strategy:
 *   - `@electric-sql/pglite` (real Postgres in WASM) for the audit-tx +
 *     sequence behavior. The DI seam in `approveVerification(params, db)`
 *     lets us pass a pglite-backed `TransactionRunner` directly.
 *   - `vi.mock('@/lib/auth/requireRole')` controls the simulated session
 *     identity.
 *   - Migration 0005 is partially borrowed for the `member_number_seq`
 *     sequence — premortem R6 mitigation. The full 0005 migration also
 *     creates privacy_requests + its enums, which this test does NOT
 *     need; we cherry-pick the CREATE SEQUENCE statement.
 *   - The `id_verified_at` and `member_number` columns are owned by
 *     ADR-0009 cycle 4 (not yet shipped). Same pattern as
 *     request-reverification-action.test.ts: the test setup ALTERs
 *     the profiles table to add the columns so the action's SQL has
 *     something to read + write. Production migration responsibility
 *     stays with ADR-0009.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

// Neutralise the server-only guard so vitest can import the action under
// happy-dom. Mirrors the pattern in tests/audit/with-audit.test.ts.
vi.mock('server-only', () => ({}));

// Module-level mock state for requireRole. Each test installs the
// behavior it needs.
const requireRoleState = vi.hoisted(() => ({
  currentActor: null as { id: string; role: 'manager' | 'owner' } | null,
}));

vi.mock('@/lib/auth/requireRole', async () => {
  const { InsufficientRoleError } =
    await vi.importActual<typeof import('@/lib/auth/errors')>('@/lib/auth/errors');
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

// `next/cache` — pass-through mocks. revalidateTag is recorded as a spy.
const cacheSpy = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
}));
vi.mock('next/cache', () => ({
  revalidateTag: cacheSpy.revalidateTag,
}));

// `@/lib/supabase/admin` — the action's defaultDb() instantiates this on
// first use. Tests inject their own db parameter so the default is never
// reached, but mocking the module prevents env-var errors during import.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('test bug: defaultDb() reached — tests must inject db param');
  },
}));

// Import AFTER mocks are set up so the action picks them up.
// eslint-disable-next-line import/first
import {
  approveVerification,
  type TransactionRunner,
} from '@/app/(admin)/admin/verifications/_actions/approveVerification';
// eslint-disable-next-line import/first
import { SelfEditViolation } from '@/app/(admin)/admin/_errors';
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

// Path resolution (Windows-safe).
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
  'verifications',
  '_actions',
  'approveVerification.ts',
);

let pg: PGlite;
let manager1: string;
let target1: string;
let target2: string;
let preVerifiedTarget: string;

interface PgliteTxLike {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Adapter that wraps pglite's `pg.transaction()` into the
 * `TransactionRunner` shape the action expects.
 */
function pgliteRunner(p: PGlite, rejectAuditInsert = false): TransactionRunner {
  return {
    transaction: async (callback) => {
      return p.transaction(async (tx: PgliteTxLike) => {
        return callback({
          query: async (sql, params) => {
            if (rejectAuditInsert && /^\s*INSERT\s+INTO\s+audit_log/i.test(sql)) {
              throw new Error('forced audit insert failure');
            }
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

  // ADR-0009 cycle 4 owns `id_verified_at` and `member_number` — add
  // the columns here so the action's SELECT / UPDATE have something
  // to address. Production migration responsibility stays with ADR-0009.
  await runSqlBlock('ALTER TABLE profiles ADD COLUMN id_verified_at TIMESTAMPTZ');
  await runSqlBlock('ALTER TABLE profiles ADD COLUMN member_number INTEGER');

  // Premortem R6 mitigation — create the `member_number_seq` sequence.
  // The full 0005 migration also creates privacy_requests + its enums;
  // we cherry-pick the CREATE SEQUENCE statement here so the test
  // doesn't pull in unrelated tables. START WITH 1000 matches the
  // production migration (room for paper-ledger backfill).
  await runSqlBlock(`
    CREATE SEQUENCE IF NOT EXISTS member_number_seq
      START WITH 1000
      INCREMENT BY 1;
  `);

  // Seed the cast of characters. Each seed creates an auth.users row +
  // a matching profile.
  const seedAs = async (
    role: 'member' | 'cashier' | 'manager' | 'owner',
    label: string,
    extras: Record<string, unknown> = {},
  ): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@approve-verif-test.local`,
      ...extras,
    });
    return profile.id;
  };

  manager1 = await seedAs('manager', 'manager1');
  // target1 / target2 — pending verification (id_verified_at NULL,
  // member_number NULL). The action under test stamps both columns.
  target1 = await seedAs('member', 'target1');
  target2 = await seedAs('member', 'target2');
  // preVerifiedTarget — already approved (idempotent no-op branch).
  // We set id_verified_at + member_number directly via seedProfile's
  // extra-column passthrough.
  preVerifiedTarget = await seedAs('member', 'preVerified', {
    id_verified_at: '2026-01-10T08:00:00.000Z',
    member_number: 500,
  });

  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'audit_log'],
    sequences: ['audit_log_id_seq', 'member_number_seq'],
  });
});

afterAll(async () => {
  await pg?.close?.();
});

beforeEach(async () => {
  await resetAuthStub(pg);
  cacheSpy.revalidateTag.mockClear();
  requireRoleState.currentActor = null;

  // Reset target state + truncate audit_log between tests. Run as
  // service-role so the UPDATE bypasses RLS + the audit_log TRUNCATE
  // bypasses the append-only policy.
  //
  // NOTE: we do NOT restart the member_number_seq between tests. The
  // sequence is monotonic across the suite by design — each
  // mutation-path test grabs the next value, and the "sequence
  // assigns increasing numbers" test (premortem R6 default path)
  // verifies this property explicitly.
  await asServiceRole(pg);
  await pg.query('UPDATE profiles SET id_verified_at = NULL, member_number = NULL WHERE id = $1', [
    target1,
  ]);
  await pg.query('UPDATE profiles SET id_verified_at = NULL, member_number = NULL WHERE id = $1', [
    target2,
  ]);
  // preVerifiedTarget stays verified across tests — that's its purpose.
  await pg.query('UPDATE profiles SET id_verified_at = $1, member_number = $2 WHERE id = $3', [
    '2026-01-10T08:00:00.000Z',
    500,
    preVerifiedTarget,
  ]);
  await pg.query('TRUNCATE TABLE audit_log RESTART IDENTITY');
});

// Helper: read audit rows for a given target_id, in id order (write order).
async function readAuditRows(
  targetId: string,
): Promise<Array<{ action: string; actor_id: string | null; before: unknown; after: unknown }>> {
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

async function readProfile(
  id: string,
): Promise<{ id_verified_at: string | null; member_number: number | null }> {
  await asServiceRole(pg);
  const r = await pg.query<{
    id_verified_at: string | null;
    member_number: number | null;
  }>('SELECT id_verified_at, member_number FROM profiles WHERE id = $1', [id]);
  return r.rows[0]!;
}

// =============================================================================
// AC12.1 — Happy path: stamps id_verified_at, assigns member_number, audits
// =============================================================================
describe('approveVerification — AC12 happy path', () => {
  it('first call mutates + writes audit row + calls revalidateTag', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const result = await approveVerification({ profileId: target1 }, pgliteRunner(pg));
    expect(result.ok).toBe(true);
    expect(typeof result.memberNumber).toBe('number');
    // Sequence starts at 1000 — but other tests in the suite may have
    // consumed values before this one (suite-wide monotonicity). The
    // member_number returned MUST be >= 1000.
    expect(result.memberNumber).toBeGreaterThanOrEqual(1000);

    // Profile row updated — id_verified_at stamped, member_number assigned.
    const profile = await readProfile(target1);
    expect(profile.id_verified_at).not.toBeNull();
    expect(profile.member_number).toBe(result.memberNumber);

    // Exactly one audit row — admin.verification.approved. The
    // profiles_protect_role_change trigger does NOT fire here because
    // we updated id_verified_at + member_number, not role.
    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.verification.approved');
    expect(rows[0]!.actor_id).toBe(manager1);

    // before/after shape — both fields only.
    const before = rows[0]!.before as {
      id_verified_at: string | null;
      member_number: number | null;
    };
    const after = rows[0]!.after as {
      id_verified_at: string | null;
      member_number: number | null;
    };
    expect(before.id_verified_at).toBeNull();
    expect(before.member_number).toBeNull();
    expect(after.id_verified_at).not.toBeNull();
    expect(after.member_number).toBe(result.memberNumber);

    expect(cacheSpy.revalidateTag).toHaveBeenCalledWith('admin-dashboard-counts');
  });
});

describe('approveVerification — transaction rollback', () => {
  it('rolls back verification and member number when the audit insert fails', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      approveVerification({ profileId: target1 }, pgliteRunner(pg, true)),
    ).rejects.toThrow('forced audit insert failure');

    const profile = await readProfile(target1);
    expect(profile.id_verified_at).toBeNull();
    expect(profile.member_number).toBeNull();
    expect(await readAuditRows(target1)).toHaveLength(0);
    expect(cacheSpy.revalidateTag).not.toHaveBeenCalled();
  });
});

// =============================================================================
// AC12.2 — Idempotent no-op: already-verified profile returns existing number
// =============================================================================
describe('approveVerification — AC12 idempotent no-op', () => {
  it('second call on already-verified profile returns existing memberNumber + writes no second audit row', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    // preVerifiedTarget starts the test with id_verified_at='2026-01-10...'
    // and member_number=500 (set in beforeEach). The action must
    // return memberNumber=500 and NOT consume a new sequence value.
    const result = await approveVerification({ profileId: preVerifiedTarget }, pgliteRunner(pg));
    expect(result).toEqual({ ok: true, memberNumber: 500 });

    // Profile row unchanged — id_verified_at still the original
    // timestamp, member_number still 500. No second-stamp.
    const profile = await readProfile(preVerifiedTarget);
    expect(profile.member_number).toBe(500);

    // Zero audit rows — idempotent branch skips the audit INSERT
    // entirely (sentinel-throw inside withAudit's mutate callback).
    const rows = await readAuditRows(preVerifiedTarget);
    expect(rows).toHaveLength(0);

    // Cache invalidation is also skipped (no count change).
    expect(cacheSpy.revalidateTag).not.toHaveBeenCalled();
  });

  it('approve then re-approve on same profile is fully idempotent (1 audit row total)', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    // First call — mutates.
    const first = await approveVerification({ profileId: target2 }, pgliteRunner(pg));
    expect(first.memberNumber).toBeGreaterThanOrEqual(1000);

    // Second call — idempotent no-op, returns SAME memberNumber.
    const second = await approveVerification({ profileId: target2 }, pgliteRunner(pg));
    expect(second.memberNumber).toBe(first.memberNumber);

    // Exactly one audit row across both calls.
    const rows = await readAuditRows(target2);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.verification.approved');
  });
});

// =============================================================================
// AC12.3 — Self-edit guard
// =============================================================================
describe('approveVerification — AC12 self-edit guard', () => {
  it('throws SelfEditViolation when profileId === actor.id (no audit row)', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      approveVerification({ profileId: manager1 }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(SelfEditViolation);

    // No audit row was written — self-edit fires BEFORE the audit tx.
    const rows = await readAuditRows(manager1);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC12.4 — No PII in audit row (AC28)
// =============================================================================
describe('approveVerification — AC28 no PII in audit row', () => {
  it('before/after JSON does not match /email|full_name|phone|dob/', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await approveVerification({ profileId: target1 }, pgliteRunner(pg));

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    const beforeJson = JSON.stringify(rows[0]!.before);
    const afterJson = JSON.stringify(rows[0]!.after);
    expect(beforeJson).not.toMatch(/email|full_name|phone|dob/);
    expect(afterJson).not.toMatch(/email|full_name|phone|dob/);
  });

  it('source file does not reference PII column names in before/after object literals', () => {
    // Source-grep defense — see AC28. The action source MUST NOT name
    // any PII column in a before/after construction.
    const src = readFileSync(ACTION_PATH, 'utf8');
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/\bemail\s*:/);
    expect(stripped).not.toMatch(/\bfull_name\s*:/);
    expect(stripped).not.toMatch(/\bphone\s*:/);
    expect(stripped).not.toMatch(/\bdob\s*:/);
  });
});

// =============================================================================
// AC12.5 — Sequence is the default path (premortem R6)
// =============================================================================
describe('approveVerification — premortem R6 sequence-is-default', () => {
  it('two distinct profile approvals assign strictly increasing member_numbers', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    // Approve target1 first — captures sequence value N.
    const r1 = await approveVerification({ profileId: target1 }, pgliteRunner(pg));

    // Approve target2 next — captures sequence value N+1 (or higher
    // if other tests in the suite consumed values between this test's
    // calls; we only assert STRICT MONOTONICITY, not delta=1).
    const r2 = await approveVerification({ profileId: target2 }, pgliteRunner(pg));

    expect(r2.memberNumber).toBeGreaterThan(r1.memberNumber);
    // Sanity: both are >= 1000 per sequence start.
    expect(r1.memberNumber).toBeGreaterThanOrEqual(1000);
    expect(r2.memberNumber).toBeGreaterThanOrEqual(1000);

    // Both profiles have their assigned numbers persisted.
    const p1 = await readProfile(target1);
    const p2 = await readProfile(target2);
    expect(p1.member_number).toBe(r1.memberNumber);
    expect(p2.member_number).toBe(r2.memberNumber);
  });
});

// =============================================================================
// Source-shape invariants (AC5, AC35)
// =============================================================================
describe('approveVerification — source-shape invariants', () => {
  it("first line is `import 'server-only';`", () => {
    const src = readFileSync(ACTION_PATH, 'utf8').replace(/^﻿/, '');
    const firstLine = src.split(/\r?\n/)[0]!.trim();
    expect(firstLine).toBe("import 'server-only';");
  });

  it("contains the literal `await requireRole('manager')` call", () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/await\s+requireRole\(\s*['"]manager['"]\s*\)/);
  });

  it("contains the literal `revalidateTag('admin-dashboard-counts')` call (AC35)", () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/revalidateTag\(\s*['"]admin-dashboard-counts['"]\s*\)/);
  });

  it("contains the literal `nextval('member_number_seq')` call (premortem R6)", () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/nextval\(\s*['"]member_number_seq['"]\s*\)/);
  });
});
