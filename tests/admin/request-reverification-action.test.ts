/**
 * Tests for `app/(admin)/admin/members/[id]/_actions/requestReverification.ts`
 * — the AC16 / WC.T13 reverification-request server action.
 *
 * Run locally:    pnpm test tests/admin/request-reverification-action.test.ts
 * Prerequisites:  none — @electric-sql/pglite (in-process WASM Postgres).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC16
 *       (resets id_verified_at to NULL; before/after audit shape; reason
 *       NOT in audit, length only; revalidateTag post-tx).
 *
 * SUT contract (per AC16):
 *   - First runtime statement is `await requireRole('manager');`.
 *   - Self-edit guard throws `SelfEditViolation` BEFORE the audit tx.
 *   - Inside withAudit('admin.member.reverification_requested', 'profile'):
 *     SELECT id_verified_at FOR UPDATE → before;
 *     UPDATE id_verified_at = NULL → side effect;
 *     before = { id_verified_at: '<iso or null>' },
 *     after  = { id_verified_at: null, reason_length: <int> }.
 *   - `reason` is NOT in audit — only its length.
 *   - Post-tx: revalidateTag('admin-dashboard-counts').
 *
 * The `id_verified_at` column is owned by ADR-0009 cycle 4 (not yet
 * shipped). The test setup ALTERs the profiles table to add the column
 * so the action's SQL has something to read + write. Tests that exercise
 * the column do so explicitly; the production migration responsibility
 * stays with ADR-0009.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

vi.mock('server-only', () => ({}));

// requireRole mock — mirrors change-role-action.test.ts.
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
  requestReverification,
  type TransactionRunner,
} from '@/app/(admin)/admin/members/[id]/_actions/requestReverification';
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
  'requestReverification.ts',
);

let pg: PGlite;
let manager1: string;
let target1: string;
let target2: string;

interface PgliteTxLike {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

function pgliteRunner(
  p: PGlite,
  rejectAuditInsert = false,
  rejectMutation = false,
): TransactionRunner {
  return {
    transaction: async (callback) => {
      return p.transaction(async (tx: PgliteTxLike) => {
        return callback({
          query: async (sql, params) => {
            if (rejectAuditInsert && /^\s*INSERT\s+INTO\s+audit_log/i.test(sql)) {
              throw new Error('test audit insert failure');
            }
            if (rejectMutation && /^\s*UPDATE\s+profiles\s+SET\s+id_verified_at/i.test(sql)) {
              throw new Error('test mutation failure');
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

  // ADR-0009 cycle 4 owns `id_verified_at` — add the column here so the
  // action's SELECT / UPDATE have something to address. Production
  // migration responsibility stays with ADR-0009.
  await runSqlBlock('ALTER TABLE profiles ADD COLUMN id_verified_at TIMESTAMPTZ');

  const seedAs = async (
    role: 'member' | 'manager',
    label: string,
    verifiedAt: string | null = null,
  ): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@req-reverif-test.local`,
      // seedProfile forwards extra columns verbatim via its index signature.
      id_verified_at: verifiedAt,
    });
    return profile.id;
  };

  manager1 = await seedAs('manager', 'manager1');
  target1 = await seedAs('member', 'target1', '2026-01-15T10:00:00.000Z');
  target2 = await seedAs('member', 'target2', null);

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

  // Reset target1's id_verified_at + TRUNCATE audit_log between tests
  // so each test sees the canonical starting state. Run as service-role
  // so the UPDATE bypasses RLS + the audit_log TRUNCATE bypasses the
  // append-only policy (BYPASSRLS at the Postgres-role layer — same
  // escape hatch ADR-0006 documents for emergency repair, used here
  // for test isolation).
  await asServiceRole(pg);
  await pg.query('UPDATE profiles SET id_verified_at = $1 WHERE id = $2', [
    '2026-01-15T10:00:00.000Z',
    target1,
  ]);
  await pg.query('UPDATE profiles SET id_verified_at = $1 WHERE id = $2', [null, target2]);
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
// AC16.1 — Happy path: id_verified_at flips to NULL, single audit row
// =============================================================================
describe('requestReverification — AC16 happy path', () => {
  it('flips id_verified_at to NULL, writes 1 audit row, calls revalidateTag', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const result = await requestReverification(
      { profileId: target1, reason: 'ID photo quality insufficient' },
      pgliteRunner(pg),
    );
    expect(result).toEqual({ ok: true });

    // Profile row updated.
    await asServiceRole(pg);
    const profile = await pg.query<{ id_verified_at: string | null }>(
      'SELECT id_verified_at FROM profiles WHERE id = $1',
      [target1],
    );
    expect(profile.rows[0]!.id_verified_at).toBeNull();

    // Exactly one audit row. Unlike changeRole, the
    // profiles_protect_role_change trigger does NOT fire here — that
    // trigger is BEFORE UPDATE OF role, and we updated id_verified_at,
    // not role.
    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.member.reverification_requested');
    expect(rows[0]!.actor_id).toBe(manager1);

    // before/after shape — id_verified_at iso string in before,
    // null + reason_length in after. The reason text itself is NOT
    // in the audit.
    const before = rows[0]!.before as { id_verified_at: string | null };
    const after = rows[0]!.after as {
      id_verified_at: string | null;
      reason_length: number;
    };
    expect(before.id_verified_at).toBe('2026-01-15T10:00:00.000Z');
    expect(after.id_verified_at).toBeNull();
    expect(after.reason_length).toBe('ID photo quality insufficient'.length);

    expect(cacheSpy.revalidateTag).toHaveBeenCalledWith('admin-dashboard-counts');
  });

  it('null pre-state (member never verified) writes before.id_verified_at: null', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await requestReverification(
      { profileId: target2, reason: 'Resubmit per updated policy' },
      pgliteRunner(pg),
    );

    const rows = await readAuditRows(target2);
    expect(rows).toHaveLength(1);
    const before = rows[0]!.before as { id_verified_at: string | null };
    expect(before.id_verified_at).toBeNull();
  });
});

describe('requestReverification — transaction rollback', () => {
  it('restores id_verified_at when the audit insert fails', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      requestReverification(
        { profileId: target1, reason: 'ID photo quality insufficient' },
        pgliteRunner(pg, true),
      ),
    ).rejects.toThrow('test audit insert failure');

    await asServiceRole(pg);
    const profile = await pg.query<{ id_verified_at: Date | string | null }>(
      'SELECT id_verified_at FROM profiles WHERE id = $1',
      [target1],
    );
    expect(new Date(profile.rows[0]!.id_verified_at!).toISOString()).toBe(
      '2026-01-15T10:00:00.000Z',
    );
    expect(await readAuditRows(target1)).toHaveLength(0);
    expect(cacheSpy.revalidateTag).not.toHaveBeenCalled();
  });

  it('writes no audit row when the profile mutation fails', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      requestReverification(
        { profileId: target1, reason: 'ID photo quality insufficient' },
        pgliteRunner(pg, false, true),
      ),
    ).rejects.toThrow('test mutation failure');

    expect(await readAuditRows(target1)).toHaveLength(0);
  });
});

// =============================================================================
// AC16.2 — Self-edit guard
// =============================================================================
describe('requestReverification — AC16 self-edit guard', () => {
  it('throws SelfEditViolation when profileId === actor.id (no audit row)', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      requestReverification({ profileId: manager1, reason: 'self-edit attempt' }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(SelfEditViolation);

    const rows = await readAuditRows(manager1);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC16.3 — Reason length validation
// =============================================================================
describe('requestReverification — AC16 reason length validation', () => {
  it('empty reason throws RangeError (no audit row)', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      requestReverification({ profileId: target1, reason: '' }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(RangeError);

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(0);
  });

  it('reason > 1000 chars throws RangeError (no audit row)', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      requestReverification({ profileId: target1, reason: 'x'.repeat(1001) }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(RangeError);

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(0);
  });

  it('exactly 1000 chars succeeds', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await requestReverification({ profileId: target1, reason: 'x'.repeat(1000) }, pgliteRunner(pg));

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    const after = rows[0]!.after as { reason_length: number };
    expect(after.reason_length).toBe(1000);
  });
});

// =============================================================================
// AC16.4 — No PII in audit row
// =============================================================================
describe('requestReverification — AC28 no PII in audit row', () => {
  it('before/after JSON does not match /email|full_name|phone|dob/', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    // Use a reason containing the verbatim word "email" — the audit
    // row MUST NOT include this content (it stores only the length).
    await requestReverification(
      { profileId: target1, reason: 'Please update your email + phone on file' },
      pgliteRunner(pg),
    );

    const rows = await readAuditRows(target1);
    expect(rows).toHaveLength(1);
    const beforeJson = JSON.stringify(rows[0]!.before);
    const afterJson = JSON.stringify(rows[0]!.after);
    expect(beforeJson).not.toMatch(/email|full_name|phone|dob/);
    expect(afterJson).not.toMatch(/email|full_name|phone|dob/);

    // Defense-in-depth: assert the verbatim reason text is NOT in the
    // audit (proves length-only capture, not just absence of PII labels).
    expect(beforeJson + afterJson).not.toContain('Please update your email');
  });

  it('source file does not reference PII column names in before/after object literals', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/\bemail\s*:/);
    expect(stripped).not.toMatch(/\bfull_name\s*:/);
    expect(stripped).not.toMatch(/\bphone\s*:/);
    expect(stripped).not.toMatch(/\bdob\s*:/);
    // The action MUST NOT store the raw reason text in the audit.
    // We allow `reason: string` in param types + `reasonLength`
    // computation, but the before/after object literal MUST NOT
    // contain `reason:` (only `reason_length:`).
    expect(stripped).not.toMatch(/before:\s*\{[^}]*\breason\s*:[^_]/);
    expect(stripped).not.toMatch(/after:\s*\{[^}]*\breason\s*:[^_]/);
  });
});

// =============================================================================
// Source-shape invariants (AC5, AC35)
// =============================================================================
describe('requestReverification — source-shape invariants', () => {
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
