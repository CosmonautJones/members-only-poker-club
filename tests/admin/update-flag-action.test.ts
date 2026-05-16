/**
 * Tests for `app/(admin)/admin/flags/_actions/updateFlag.ts` — the AC22 /
 * WC.T16 feature-flag mutation action.
 *
 * Run locally:    pnpm test tests/admin/update-flag-action.test.ts
 * Prerequisites:  none — @electric-sql/pglite (in-process WASM Postgres).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC22
 *       (most-specific-first audit selection; NoChange guard; percent
 *       validation; cashier-session rejection; no-PII audit).
 *
 * SUT contract (per AC22):
 *   - First runtime statement is `await requireRole('manager');`.
 *   - At least one of enabled/percent/allowlist/roleGate must be present
 *     else throw NoChange (no audit row).
 *   - Most-specific-first audit-event selection:
 *       enabled → admin.flag.toggled
 *       percent → admin.flag.percent_changed
 *       allowlist → admin.flag.allowlist_changed
 *       roleGate → admin.flag.role_gate_changed
 *   - enabled + percent multi-change → ONE admin.flag.toggled row.
 *   - percent ∈ [0,100] validated; out-of-range throws RangeError.
 *   - cashier-roled session → InsufficientRoleError.
 *   - revalidateTag('admin-dashboard-counts') called post-tx.
 *   - audit before/after JSON does NOT match /email|full_name|phone|dob/.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

vi.mock('server-only', () => ({}));

const requireRoleState = vi.hoisted(() => ({
  currentActor: null as { id: string; role: 'cashier' | 'manager' | 'owner' } | null,
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

const cacheSpy = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: cacheSpy.revalidateTag }));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('test bug: defaultDb() reached — tests must inject db param');
  },
}));

// eslint-disable-next-line import/first
import { updateFlag, type TransactionRunner } from '@/app/(admin)/admin/flags/_actions/updateFlag';
// eslint-disable-next-line import/first
import { NoChange } from '@/app/(admin)/admin/_errors';
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
const MIG_0001 = resolve(TEST_DIR, '..', '..', 'supabase', 'migrations', '0001_feature_flags.sql');
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
  'flags',
  '_actions',
  'updateFlag.ts',
);

let pg: PGlite;
let manager1: string;
let cashier1: string;

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
  await runSqlBlock(readFileSync(MIG_0001, 'utf8'));
  await runSqlBlock(readFileSync(MIG_0002, 'utf8'));
  await runSqlBlock(readFileSync(MIG_0003, 'utf8'));

  const seedAs = async (role: 'cashier' | 'manager', label: string): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@update-flag-test.local`,
    });
    return profile.id;
  };

  manager1 = await seedAs('manager', 'manager1');
  cashier1 = await seedAs('cashier', 'cashier1');

  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'audit_log', 'feature_flags'],
    sequences: ['audit_log_id_seq'],
  });
});

afterAll(async () => {
  await pg?.close?.();
});

const TEST_FLAG_KEY = 'show-leaderboard';

beforeEach(async () => {
  await resetAuthStub(pg);
  cacheSpy.revalidateTag.mockClear();
  requireRoleState.currentActor = null;

  await asServiceRole(pg);
  // Reset feature_flags + audit_log between tests so each starts from
  // the canonical seed. Service-role bypasses RLS + the audit_log
  // append-only policy.
  await pg.query('TRUNCATE TABLE feature_flags');
  await pg.query('TRUNCATE TABLE audit_log RESTART IDENTITY');
  await pg.query(
    `INSERT INTO feature_flags (key, enabled, percent, allowlist, role_gate, owner, expires_at, updated_at, updated_by)
       VALUES ($1, false, 0, '{}'::text[], NULL, 'product', NULL, now(), NULL)`,
    [TEST_FLAG_KEY],
  );
});

async function readAuditRows(
  targetKey: string,
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
      WHERE target_type = 'feature_flag' AND target_id = $1
      ORDER BY id ASC`,
    [targetKey],
  );
  return result.rows;
}

async function readFlag(key: string): Promise<{
  enabled: boolean;
  percent: number;
  allowlist: string[];
  role_gate: string | null;
  updated_by: string | null;
}> {
  await asServiceRole(pg);
  const result = await pg.query<{
    enabled: boolean;
    percent: number;
    allowlist: string[];
    role_gate: string | null;
    updated_by: string | null;
  }>(
    'SELECT enabled, percent, allowlist, role_gate, updated_by::text AS updated_by FROM feature_flags WHERE key = $1',
    [key],
  );
  return result.rows[0]!;
}

// =============================================================================
// AC22.1 — Each mutation kind matches the correct audit event
// =============================================================================
describe('updateFlag — AC22 audit event selection (single-field changes)', () => {
  it('enabled-only → admin.flag.toggled (single audit row)', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const result = await updateFlag({ key: TEST_FLAG_KEY, enabled: true }, pgliteRunner(pg));
    expect(result).toEqual({ ok: true });

    const flag = await readFlag(TEST_FLAG_KEY);
    expect(flag.enabled).toBe(true);
    expect(flag.updated_by).toBe(manager1);

    const rows = await readAuditRows(TEST_FLAG_KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.flag.toggled');
    expect(rows[0]!.actor_id).toBe(manager1);

    const before = rows[0]!.before as { enabled: boolean };
    const after = rows[0]!.after as { enabled: boolean };
    expect(before.enabled).toBe(false);
    expect(after.enabled).toBe(true);

    expect(cacheSpy.revalidateTag).toHaveBeenCalledWith('admin-dashboard-counts');
  });

  it('percent-only → admin.flag.percent_changed', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await updateFlag({ key: TEST_FLAG_KEY, percent: 50 }, pgliteRunner(pg));

    const rows = await readAuditRows(TEST_FLAG_KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.flag.percent_changed');

    const flag = await readFlag(TEST_FLAG_KEY);
    expect(flag.percent).toBe(50);
  });

  it('allowlist-only → admin.flag.allowlist_changed', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await updateFlag({ key: TEST_FLAG_KEY, allowlist: [manager1] }, pgliteRunner(pg));

    const rows = await readAuditRows(TEST_FLAG_KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.flag.allowlist_changed');

    const flag = await readFlag(TEST_FLAG_KEY);
    expect(flag.allowlist).toEqual([manager1]);
  });

  it('roleGate-only → admin.flag.role_gate_changed', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await updateFlag({ key: TEST_FLAG_KEY, roleGate: 'manager' }, pgliteRunner(pg));

    const rows = await readAuditRows(TEST_FLAG_KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.flag.role_gate_changed');

    const flag = await readFlag(TEST_FLAG_KEY);
    expect(flag.role_gate).toBe('manager');
  });
});

// =============================================================================
// AC22.2 — Most-specific-first wins on multi-field changes
// =============================================================================
describe('updateFlag — AC22 most-specific-first audit selection', () => {
  it('enabled + percent multi-change → ONE admin.flag.toggled row (most-specific wins)', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await updateFlag({ key: TEST_FLAG_KEY, enabled: true, percent: 75 }, pgliteRunner(pg));

    const rows = await readAuditRows(TEST_FLAG_KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.flag.toggled');

    // Both columns updated on the row even though the audit verb is
    // the most-specific one.
    const flag = await readFlag(TEST_FLAG_KEY);
    expect(flag.enabled).toBe(true);
    expect(flag.percent).toBe(75);
  });

  it('percent + allowlist multi-change → admin.flag.percent_changed (percent wins over allowlist)', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await updateFlag({ key: TEST_FLAG_KEY, percent: 25, allowlist: [manager1] }, pgliteRunner(pg));

    const rows = await readAuditRows(TEST_FLAG_KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.flag.percent_changed');
  });

  it('allowlist + roleGate multi-change → admin.flag.allowlist_changed (allowlist wins over roleGate)', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await updateFlag(
      { key: TEST_FLAG_KEY, allowlist: [manager1], roleGate: 'cashier' },
      pgliteRunner(pg),
    );

    const rows = await readAuditRows(TEST_FLAG_KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('admin.flag.allowlist_changed');
  });
});

// =============================================================================
// AC22.3 — NoChange guard
// =============================================================================
describe('updateFlag — NoChange guard', () => {
  it('no fields provided → throws NoChange, no audit row', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(updateFlag({ key: TEST_FLAG_KEY }, pgliteRunner(pg))).rejects.toBeInstanceOf(
      NoChange,
    );

    const rows = await readAuditRows(TEST_FLAG_KEY);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC22.4 — Percent validation
// =============================================================================
describe('updateFlag — percent validation', () => {
  it('percent < 0 → throws RangeError, no audit row', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      updateFlag({ key: TEST_FLAG_KEY, percent: -1 }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(RangeError);

    const rows = await readAuditRows(TEST_FLAG_KEY);
    expect(rows).toHaveLength(0);
  });

  it('percent > 100 → throws RangeError, no audit row', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      updateFlag({ key: TEST_FLAG_KEY, percent: 101 }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(RangeError);

    const rows = await readAuditRows(TEST_FLAG_KEY);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC22.5 — Role gate (cashier rejection)
// =============================================================================
describe('updateFlag — role gate', () => {
  it('cashier-roled session → throws InsufficientRoleError, no audit row', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: cashier1, role: 'cashier' };
    await setTestUid(pg, cashier1);
    await asAuthenticated(pg, cashier1);

    await expect(
      updateFlag({ key: TEST_FLAG_KEY, enabled: true }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(InsufficientRoleError);

    const rows = await readAuditRows(TEST_FLAG_KEY);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC28 — No PII in audit
// =============================================================================
describe('updateFlag — AC28 no PII in audit row', () => {
  it('before/after JSON does NOT match /email|full_name|phone|dob/', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await updateFlag(
      {
        key: TEST_FLAG_KEY,
        enabled: true,
        percent: 50,
        allowlist: [manager1],
        roleGate: 'manager',
      },
      pgliteRunner(pg),
    );

    const rows = await readAuditRows(TEST_FLAG_KEY);
    expect(rows).toHaveLength(1);
    const beforeJson = JSON.stringify(rows[0]!.before);
    const afterJson = JSON.stringify(rows[0]!.after);
    expect(beforeJson).not.toMatch(/email|full_name|phone|dob/);
    expect(afterJson).not.toMatch(/email|full_name|phone|dob/);
  });

  it('source file does not reference PII column names in before/after object literals', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/\bemail\s*:/);
    expect(stripped).not.toMatch(/\bfull_name\s*:/);
    expect(stripped).not.toMatch(/\bphone\s*:/);
    expect(stripped).not.toMatch(/\bdob\s*:/);
  });
});

// =============================================================================
// Source-shape invariants (AC5, AC35)
// =============================================================================
describe('updateFlag — source-shape invariants', () => {
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

  it('contains a TODO comment for the in-memory flag-cache invalidation hook', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/TODO[\s\S]{0,80}lib\/flags\/registry/);
  });
});
