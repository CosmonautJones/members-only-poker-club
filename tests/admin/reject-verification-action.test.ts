/**
 * Tests for `app/(admin)/admin/verifications/_actions/rejectVerification.ts`
 * — the AC13 / WB.T9 reject-verification server action.
 *
 * Run locally:    pnpm test tests/admin/reject-verification-action.test.ts
 * Prerequisites:  none — @electric-sql/pglite (in-process WASM Postgres).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC13
 *       (reason length 1..500, RejectReasonInvalid; UPDATE rejected_at +
 *       rejected_reason; audit row keeps staff-authored reason verbatim;
 *       revalidateTag post-tx).
 *
 * SUT contract (per AC13 + conductor t11 brief):
 *   - First runtime statement is `await requireRole('manager');`.
 *   - Self-edit guard throws `SelfEditViolation` BEFORE the audit tx.
 *   - Reason length 1..500 — else throws `RejectReasonInvalid`.
 *   - Inside withAudit('admin.verification.rejected', 'profile'):
 *     SELECT id_verification_rejected_at FOR UPDATE → before;
 *     UPDATE id_verification_rejected_at=now(), id_verification_rejected_reason=$2;
 *     SELECT → after.
 *   - before = { id_verification_rejected_at: <iso|null> };
 *     after  = { id_verification_rejected_at: '<iso>', reason: <verbatim text> }.
 *   - Post-tx: revalidateTag('admin-dashboard-counts').
 *
 * The `id_verification_rejected_at` + `id_verification_rejected_reason`
 * columns are owned by ADR-0009 (cycle 4 — not yet shipped in repo).
 * The test setup ALTERs the profiles table to add the columns so the
 * action's SQL has something to read + write. Tests that exercise the
 * columns do so explicitly; the production migration responsibility
 * stays with ADR-0009.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

vi.mock('server-only', () => ({}));

// requireRole mock — mirrors request-reverification-action.test.ts.
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

const cacheSpy = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
}));
vi.mock('next/cache', () => ({
  revalidateTag: cacheSpy.revalidateTag,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('test bug: defaultDb() reached — tests must inject db param');
  },
}));

// eslint-disable-next-line import/first
import {
  rejectVerification,
  type TransactionRunner,
} from '@/app/(admin)/admin/verifications/_actions/rejectVerification';
// eslint-disable-next-line import/first
import { SelfEditViolation, RejectReasonInvalid } from '@/app/(admin)/admin/_errors';
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
  'verifications',
  '_actions',
  'rejectVerification.ts',
);

let pg: PGlite;
let manager1: string;
let target1: string;
let target2: string;

interface PgliteTxLike {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

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

  // ADR-0009 cycle 4 owns these columns — add them here so the action's
  // SELECT / UPDATE have something to address. Production migration
  // responsibility stays with ADR-0009.
  await runSqlBlock('ALTER TABLE profiles ADD COLUMN id_verification_rejected_at TIMESTAMPTZ');
  await runSqlBlock('ALTER TABLE profiles ADD COLUMN id_verification_rejected_reason TEXT');

  const seedAs = async (role: 'member' | 'manager', label: string): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@reject-verif-test.local`,
    });
    return profile.id;
  };

  manager1 = await seedAs('manager', 'manager1');
  target1 = await seedAs('member', 'target1');
  target2 = await seedAs('member', 'target2');

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
  cacheSpy.revalidateTag.mockClear();
  requireRoleState.currentActor = null;

  // Reset the rejected_* columns + TRUNCATE audit_log between tests.
  // Run as service-role so the UPDATE bypasses RLS + the audit_log
  // TRUNCATE bypasses the append-only policy.
  await asServiceRole(pg);
  await pg.query(
    'UPDATE profiles SET id_verification_rejected_at = NULL, id_verification_rejected_reason = NULL WHERE id IN ($1, $2)',
    [target1, target2],
  );
  await pg.query('TRUNCATE TABLE audit_log RESTART IDENTITY');
});

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

// =============================================================================
// AC13.1 — Happy path: rejected_at set, reason stored verbatim, audit row
// =============================================================================
describe('rejectVerification — AC13 happy path', () => {
  it('sets rejected_at + reason, writes audit row with verbatim reason, calls revalidateTag', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const reasonText = 'ID photo is blurry — please re-upload';
    const result = await rejectVerification(
      { profileId: target1, reason: reasonText },
      pgliteRunner(pg),
    );
    expect(result).toEqual({ ok: true });

    // Profile row updated.
    await asServiceRole(pg);
    const profile = await pg.query<{
      id_verification_rejected_at: string | Date | null;
      id_verification_rejected_reason: string | null;
    }>(
      'SELECT id_verification_rejected_at, id_verification_rejected_reason FROM profiles WHERE id = $1',
      [target1],
    );
    expect(profile.rows[0]!.id_verification_rejected_at).not.toBeNull();
    expect(profile.rows[0]!.id_verification_rejected_reason).toBe(reasonText);

    // Exactly one audit row.
    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.verification.rejected');
    expect(rows[0]!.actor_id).toBe(manager1);

    // before/after shape — before timestamp null on first reject;
    // after carries timestamp + verbatim reason text.
    const before = rows[0]!.before as { id_verification_rejected_at: string | null };
    const after = rows[0]!.after as {
      id_verification_rejected_at: string | null;
      reason: string;
    };
    expect(before.id_verification_rejected_at).toBeNull();
    expect(after.id_verification_rejected_at).toBeTruthy();
    expect(after.reason).toBe(reasonText);

    expect(cacheSpy.revalidateTag).toHaveBeenCalledWith('admin-dashboard-counts');
  });

  it('reason at exactly 1 char succeeds', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await rejectVerification({ profileId: target1, reason: 'x' }, pgliteRunner(pg));

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    const after = rows[0]!.after as { reason: string };
    expect(after.reason).toBe('x');
  });

  it('reason at exactly 500 chars succeeds', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const reasonText = 'r'.repeat(500);
    await rejectVerification({ profileId: target1, reason: reasonText }, pgliteRunner(pg));

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    const after = rows[0]!.after as { reason: string };
    expect(after.reason).toHaveLength(500);
    expect(after.reason).toBe(reasonText);
  });

  it('re-reject overwrites timestamp + reason and writes a second audit row', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await rejectVerification({ profileId: target1, reason: 'first reason' }, pgliteRunner(pg));
    await rejectVerification({ profileId: target1, reason: 'second reason' }, pgliteRunner(pg));

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(2);
    const firstAfter = rows[0]!.after as { reason: string };
    const secondBefore = rows[1]!.before as { id_verification_rejected_at: string | null };
    const secondAfter = rows[1]!.after as { reason: string };
    expect(firstAfter.reason).toBe('first reason');
    // The second call's `before` is the timestamp from the first call
    // (non-null). pglite returns ISO strings via JSON.parse; either an
    // ISO string OR a parseable Date-string is acceptable. The key
    // contract is "not null" — re-reject reads the prior timestamp.
    expect(secondBefore.id_verification_rejected_at).not.toBeNull();
    expect(secondAfter.reason).toBe('second reason');
  });
});

describe('rejectVerification — transaction rollback', () => {
  it('rolls back rejection fields when the audit insert fails', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      rejectVerification(
        { profileId: target1, reason: 'Document image is unreadable.' },
        pgliteRunner(pg, true),
      ),
    ).rejects.toThrow('forced audit insert failure');

    await asServiceRole(pg);
    const profile = await pg.query<{
      id_verification_rejected_at: string | null;
      id_verification_rejected_reason: string | null;
    }>(
      `SELECT id_verification_rejected_at, id_verification_rejected_reason
         FROM profiles
        WHERE id = $1`,
      [target1],
    );
    expect(profile.rows[0]!.id_verification_rejected_at).toBeNull();
    expect(profile.rows[0]!.id_verification_rejected_reason).toBeNull();
    expect(await readAuditRows(target1)).toHaveLength(0);
    expect(cacheSpy.revalidateTag).not.toHaveBeenCalled();
  });
});

// =============================================================================
// AC13.2 — Self-edit guard
// =============================================================================
describe('rejectVerification — AC13 self-edit guard', () => {
  it('throws SelfEditViolation when profileId === actor.id (no audit row)', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      rejectVerification({ profileId: manager1, reason: 'self-edit attempt' }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(SelfEditViolation);

    const rows = await readAuditRows(manager1);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC13.3 — Reason length validation
// =============================================================================
describe('rejectVerification — AC13 reason length validation', () => {
  it('empty reason throws RejectReasonInvalid (no audit row)', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      rejectVerification({ profileId: target1, reason: '' }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(RejectReasonInvalid);

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(0);
  });

  it('reason at exactly 501 chars throws RejectReasonInvalid (no audit row)', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      rejectVerification({ profileId: target1, reason: 'x'.repeat(501) }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(RejectReasonInvalid);

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC13.4 — Audit row shape (cross-checks AC28 source-grep contract)
// =============================================================================
describe('rejectVerification — audit row shape', () => {
  it('audit before/after JSON does not match /email|full_name|phone|dob/ and does not contain the substring "reject_reason"', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    // Reason text deliberately contains PII-shaped words to prove the
    // assertion fires on column-name substrings, not on the reason
    // body. The key is "reason:" (allowed by AC28) — the substring
    // "reject_reason:" must NOT appear in the audit JSON.
    await rejectVerification(
      { profileId: target1, reason: 'please update your email on file' },
      pgliteRunner(pg),
    );

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    const beforeJson = JSON.stringify(rows[0]!.before);
    const afterJson = JSON.stringify(rows[0]!.after);

    // The audit MAY contain the verbatim reason text (which itself
    // contains the word "email"); AC28's source-grep guard runs
    // against the source file's before/after object literals, not
    // against runtime audit content. We assert the column-name
    // substrings (which would indicate a structural PII leak) are
    // absent from the keys.
    const beforeKeys = Object.keys(rows[0]!.before as object);
    const afterKeys = Object.keys(rows[0]!.after as object);
    expect(beforeKeys).not.toContain('email');
    expect(beforeKeys).not.toContain('full_name');
    expect(beforeKeys).not.toContain('phone');
    expect(beforeKeys).not.toContain('dob');
    expect(afterKeys).not.toContain('email');
    expect(afterKeys).not.toContain('full_name');
    expect(afterKeys).not.toContain('phone');
    expect(afterKeys).not.toContain('dob');

    // AC28: 'reject_reason:' full text forbidden. The audit uses the
    // shorter `reason:` key — assert the forbidden substring is
    // absent from the runtime JSON too.
    expect(beforeJson).not.toContain('"reject_reason"');
    expect(afterJson).not.toContain('"reject_reason"');
  });

  it('source file does not contain the forbidden substring "reject_reason:" in before/after object literals (AC28 spot-check)', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // The AC28 cross-cutting grep test (t21) runs against all action
    // files; this spot-check pins the contract here so a regression
    // in this specific file fails its own suite.
    expect(stripped).not.toMatch(/before:\s*\{[^}]*\breject_reason\s*:/);
    expect(stripped).not.toMatch(/after:\s*\{[^}]*\breject_reason\s*:/);
    // Same posture for the other PII labels.
    expect(stripped).not.toMatch(/before:\s*\{[^}]*\bemail\s*:/);
    expect(stripped).not.toMatch(/after:\s*\{[^}]*\bemail\s*:/);
  });
});

// =============================================================================
// Source-shape invariants (AC5, AC35)
// =============================================================================
describe('rejectVerification — source-shape invariants', () => {
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
});
