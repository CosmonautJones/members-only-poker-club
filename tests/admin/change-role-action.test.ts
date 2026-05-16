/**
 * Tests for `app/(admin)/admin/members/[id]/_actions/changeRole.ts`
 * — the AC15 / WC.T12 role-change server action.
 *
 * Run locally:    pnpm test tests/admin/change-role-action.test.ts
 * Prerequisites:  none — @electric-sql/pglite (in-process WASM Postgres).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC15
 *       (role-ladder authority refine + self-edit guard + two-audit-
 *       rows-per-role-change invariant + no-PII in before/after).
 *
 * SUT contract (per AC15):
 *   - First runtime statement is `await requireRole('manager');` (outer gate).
 *   - Self-edit guard throws `SelfEditViolation` BEFORE the audit tx opens.
 *   - Role-ladder authority refine (the AC15 failure matrix is the
 *     load-bearing contract; the narrative gloss is a simplification):
 *       * Promotion (newRank > currentRank) → requires owner;
 *         surfaces as `InsufficientRoleError` when caller is `manager`.
 *       * Demotion FROM the manager+ band (currentRole ∈ {manager, owner})
 *         → requires owner (manager→cashier denies a manager session).
 *       * Demotion within the non-staff band (cashier→member) → manager OK.
 *       * Multi-rung demotion (currentRank - newRank > 1) →
 *         `RoleLadderViolation`, checked BEFORE the owner-required gate
 *         so an owner attempting owner→member still throws.
 *   - No-op early return (newRole === currentRole) — no audit row written.
 *   - Inside withAudit('admin.member.role_changed', 'profile', profileId):
 *     SELECT role FOR UPDATE → before; UPDATE; SELECT → after.
 *   - DB trigger `profiles_protect_role_change` ALSO writes
 *     `profile.role_change` audit row — TWO rows per role change.
 *   - before/after carry only `{ role }` — NO PII.
 *
 * Test substrate strategy:
 *   - `@electric-sql/pglite` (real Postgres in WASM) for the audit-tx +
 *     trigger behavior. The DI seam in `changeRole(params, db)` lets us
 *     pass a pglite-backed `TransactionRunner` directly.
 *   - `vi.mock('@/lib/auth/requireRole')` controls the simulated session
 *     identity. The mock raises `InsufficientRoleError` on `requireRole('owner')`
 *     when the test's "current actor" is a manager — that is the spec's
 *     promotion-as-manager surface.
 *   - Migrations 0002 + 0003 (profiles + audit_log) are applied so the
 *     trigger + audit_log table both exist; the trigger emission is the
 *     second-audit-row source.
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
// behavior it needs (current actor + whether the owner refine throws).
const requireRoleState = vi.hoisted(() => ({
  currentActor: null as { id: string; role: 'manager' | 'owner' } | null,
}));

vi.mock('@/lib/auth/requireRole', async () => {
  // Pull in the real InsufficientRoleError so `instanceof` checks against
  // the mock match the production error class. The mock only fakes the
  // requireRole function — the error class itself is the real one.
  const { InsufficientRoleError } =
    await vi.importActual<typeof import('@/lib/auth/errors')>('@/lib/auth/errors');
  return {
    requireRole: vi.fn(async (required: 'manager' | 'owner') => {
      const actor = requireRoleState.currentActor;
      if (!actor) {
        // Mirror production behavior — no session means redirect, but the
        // tests always seed an actor before calling. If we ever hit this
        // branch, fail the test with a pointed message rather than
        // throwing a generic NEXT_REDIRECT.
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
  changeRole,
  type TransactionRunner,
} from '@/app/(admin)/admin/members/[id]/_actions/changeRole';
// eslint-disable-next-line import/first
import { SelfEditViolation, RoleLadderViolation } from '@/app/(admin)/admin/_errors';
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
  'members',
  '[id]',
  '_actions',
  'changeRole.ts',
);

let pg: PGlite;
let manager1: string;
let manager2: string;
let owner1: string;
let cashier1: string;
let member1: string;
let memberTarget: string;
let cashierTarget: string;
let managerTarget: string;
let ownerTarget: string;

interface PgliteTxLike {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Adapter that wraps pglite's `pg.transaction()` into the
 * `TransactionRunner` shape the action expects. Mirrors the txClient
 * helper in tests/audit/with-audit.test.ts.
 */
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

  // Seed the cast of characters. Each seed creates an auth.users row +
  // a matching profile. The action's self-edit guard compares
  // profileId to session.user.id; the role-ladder math reads + writes
  // profiles.role.
  const seedAs = async (
    role: 'member' | 'cashier' | 'manager' | 'owner',
    label: string,
  ): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@change-role-test.local`,
    });
    return profile.id;
  };

  manager1 = await seedAs('manager', 'manager1');
  manager2 = await seedAs('manager', 'manager2');
  owner1 = await seedAs('owner', 'owner1');
  cashier1 = await seedAs('cashier', 'cashier1');
  member1 = await seedAs('member', 'member1');
  memberTarget = await seedAs('member', 'memberTarget');
  cashierTarget = await seedAs('cashier', 'cashierTarget');
  managerTarget = await seedAs('manager', 'managerTarget');
  ownerTarget = await seedAs('owner', 'ownerTarget');

  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'audit_log'],
    sequences: ['audit_log_id_seq'],
  });

  // Suppress unused-variable warning for fixtures not used in every test.
  void manager2;
  void cashier1;
  void member1;
});

afterAll(async () => {
  await pg?.close?.();
});

beforeEach(async () => {
  await resetAuthStub(pg);
  cacheSpy.revalidateTag.mockClear();
  requireRoleState.currentActor = null;

  // Reset target roles + truncate audit_log so each test sees the
  // canonical starting state. Run as service-role / superuser so the
  // UPDATE bypasses the profiles_protect_role_change trigger
  // (auth.uid() IS NULL satisfies the bypass branch) and the
  // audit_log TRUNCATE bypasses the append-only RLS posture
  // (BYPASSRLS at the Postgres-role layer — same escape hatch
  // ADR-0006 documents for emergency repair, used here for test
  // isolation).
  await asServiceRole(pg);
  await pg.query('UPDATE profiles SET role = $1 WHERE id = $2', ['member', memberTarget]);
  await pg.query('UPDATE profiles SET role = $1 WHERE id = $2', ['cashier', cashierTarget]);
  await pg.query('UPDATE profiles SET role = $1 WHERE id = $2', ['manager', managerTarget]);
  await pg.query('UPDATE profiles SET role = $1 WHERE id = $2', ['owner', ownerTarget]);
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

// =============================================================================
// AC15.1 — Self-edit guard
// =============================================================================
describe('changeRole — AC15 self-edit guard', () => {
  it('throws SelfEditViolation when profileId === actor.id (no audit row)', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      changeRole({ profileId: manager1, newRole: 'cashier' }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(SelfEditViolation);

    // No audit row was written — self-edit fires BEFORE the audit tx.
    const rows = await readAuditRows(manager1);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC15.2 — Promotion-as-manager throws InsufficientRoleError
// =============================================================================
describe('changeRole — AC15 promotion-as-manager denied', () => {
  it('manager promoting member→cashier throws InsufficientRoleError; no audit row', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    // member→cashier is a promotion (rank 0 → 1). Promotions require
    // owner authority; manager session must surface InsufficientRoleError.
    await expect(
      changeRole({ profileId: memberTarget, newRole: 'cashier' }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(InsufficientRoleError);

    const rows = await readAuditRows(memberTarget);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC15.3 — Promotion-as-owner succeeds with two audit rows
// =============================================================================
describe('changeRole — AC15 promotion-as-owner succeeds + 2 audit rows', () => {
  it('owner promoting member→cashier writes 2 audit rows (admin.member.role_changed + profile.role_change)', async () => {
    requireRoleState.currentActor = { id: owner1, role: 'owner' };
    await setTestUid(pg, owner1);
    await asAuthenticated(pg, owner1);

    const result = await changeRole(
      { profileId: memberTarget, newRole: 'cashier' },
      pgliteRunner(pg),
    );
    expect(result).toEqual({ ok: true, changed: true });

    const rows = await readAuditRows(memberTarget);
    expect(rows).toHaveLength(2);

    // The two audit rows: one from withAudit (action='admin.member.role_changed'),
    // one from the trigger (action='profile.role_change'). The trigger fires
    // BEFORE the action's audit INSERT, so order is trigger → withAudit.
    const actions = rows.map((r) => r.action).sort();
    expect(actions).toEqual(['admin.member.role_changed', 'profile.role_change']);

    // Both rows target the same profile and same actor (owner1).
    rows.forEach((r) => {
      expect(r.actor_id).toBe(owner1);
    });

    // Profile row updated.
    await asServiceRole(pg);
    const profile = await pg.query<{ role: string }>('SELECT role FROM profiles WHERE id = $1', [
      memberTarget,
    ]);
    expect(profile.rows[0]!.role).toBe('cashier');

    // revalidateTag('admin-dashboard-counts') was called post-tx.
    expect(cacheSpy.revalidateTag).toHaveBeenCalledWith('admin-dashboard-counts');
  });
});

// =============================================================================
// AC15.4 — Demotion cashier→member as manager succeeds
// =============================================================================
describe('changeRole — AC15 cashier→member as manager (one-rung demotion)', () => {
  it('manager demoting cashier→member succeeds', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const result = await changeRole(
      { profileId: cashierTarget, newRole: 'member' },
      pgliteRunner(pg),
    );
    expect(result).toEqual({ ok: true, changed: true });

    const rows = await readAuditRows(cashierTarget);
    expect(rows).toHaveLength(2);
    const actions = rows.map((r) => r.action).sort();
    expect(actions).toEqual(['admin.member.role_changed', 'profile.role_change']);

    await asServiceRole(pg);
    const profile = await pg.query<{ role: string }>('SELECT role FROM profiles WHERE id = $1', [
      cashierTarget,
    ]);
    expect(profile.rows[0]!.role).toBe('member');
  });
});

// =============================================================================
// AC15.5 — Demotion manager→cashier as manager throws (owner-only)
// =============================================================================
describe('changeRole — AC15 manager→cashier as manager denied', () => {
  it('manager demoting manager→cashier throws InsufficientRoleError', async () => {
    // SUBTLE: this is a one-rung DEMOTION (rank 2 → 1), which the spec
    // says is covered by the outer manager gate. BUT — per the spec's
    // failure matrix: "Demotion manager → cashier as manager → throws
    // InsufficientRoleError". The implementation MUST treat manager→cashier
    // as an owner-only operation (it crosses the manager/cashier boundary,
    // which is the privilege-removal moment). This is a special-case
    // tightening above the bare one-rung rule.
    expect.assertions(2);
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    await expect(
      changeRole({ profileId: managerTarget, newRole: 'cashier' }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(InsufficientRoleError);

    const rows = await readAuditRows(managerTarget);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC15.6 — Demotion manager→cashier as owner succeeds
// =============================================================================
describe('changeRole — AC15 manager→cashier as owner succeeds', () => {
  it('owner demoting manager→cashier succeeds + 2 audit rows', async () => {
    requireRoleState.currentActor = { id: owner1, role: 'owner' };
    await setTestUid(pg, owner1);
    await asAuthenticated(pg, owner1);

    const result = await changeRole(
      { profileId: managerTarget, newRole: 'cashier' },
      pgliteRunner(pg),
    );
    expect(result).toEqual({ ok: true, changed: true });

    const rows = await readAuditRows(managerTarget);
    expect(rows).toHaveLength(2);

    await asServiceRole(pg);
    const profile = await pg.query<{ role: string }>('SELECT role FROM profiles WHERE id = $1', [
      managerTarget,
    ]);
    expect(profile.rows[0]!.role).toBe('cashier');
  });
});

// =============================================================================
// AC15.7 — Multi-rung demotion throws RoleLadderViolation
// =============================================================================
describe('changeRole — AC15 multi-rung demotion forbidden', () => {
  it('owner→member (skipping manager+cashier) throws RoleLadderViolation; no audit row', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: owner1, role: 'owner' };
    await setTestUid(pg, owner1);
    await asAuthenticated(pg, owner1);

    await expect(
      changeRole({ profileId: ownerTarget, newRole: 'member' }, pgliteRunner(pg)),
    ).rejects.toBeInstanceOf(RoleLadderViolation);

    const rows = await readAuditRows(ownerTarget);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC15.8 — No-op early return (newRole === currentRole)
// =============================================================================
describe('changeRole — AC15 no-op early return', () => {
  it('newRole === currentRole returns { changed: false } with no audit row', async () => {
    requireRoleState.currentActor = { id: manager1, role: 'manager' };
    await setTestUid(pg, manager1);
    await asAuthenticated(pg, manager1);

    const result = await changeRole(
      { profileId: memberTarget, newRole: 'member' },
      pgliteRunner(pg),
    );
    expect(result).toEqual({ ok: true, changed: false });

    const rows = await readAuditRows(memberTarget);
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// AC15.9 — AC28 no-PII: audit JSON does not contain email/full_name/phone/dob
// =============================================================================
describe('changeRole — AC28 no PII in audit row', () => {
  it('before/after JSON does not match /email|full_name|phone|dob/', async () => {
    requireRoleState.currentActor = { id: owner1, role: 'owner' };
    await setTestUid(pg, owner1);
    await asAuthenticated(pg, owner1);

    await changeRole({ profileId: memberTarget, newRole: 'cashier' }, pgliteRunner(pg));

    const rows = await readAuditRows(memberTarget);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const beforeJson = JSON.stringify(row.before);
      const afterJson = JSON.stringify(row.after);
      expect(beforeJson).not.toMatch(/email|full_name|phone|dob/);
      expect(afterJson).not.toMatch(/email|full_name|phone|dob/);
    }
  });

  it('source file does not reference PII column names in before/after object literals', () => {
    // Source-grep defense — see AC28. The action source MUST NOT name
    // any PII column in a before/after construction. We allow the
    // literal strings to appear in comments / JSDoc, but the object
    // literal keys must be limited to `role`.
    //
    // We strip block + line comments first so JSDoc mentions like
    // "no PII (email/full_name/...)" don't false-positive the grep.
    const src = readFileSync(ACTION_PATH, 'utf8');
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // The action constructs before/after as { role: ... }. Any PII key
    // would appear as `email:`, `full_name:`, etc. in the object literal.
    expect(stripped).not.toMatch(/\bemail\s*:/);
    expect(stripped).not.toMatch(/\bfull_name\s*:/);
    expect(stripped).not.toMatch(/\bphone\s*:/);
    expect(stripped).not.toMatch(/\bdob\s*:/);
  });
});

// =============================================================================
// Source-shape — `import 'server-only';` is the first line, first await is
// requireRole, action contains revalidateTag literal.
// =============================================================================
describe('changeRole — source-shape invariants (AC5, AC35)', () => {
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
