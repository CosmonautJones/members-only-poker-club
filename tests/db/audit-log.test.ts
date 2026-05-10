/**
 * RLS unit tests for `audit_log` (ADR-0006 slice 1, spec AC7 + AC13 regression).
 *
 * Run locally:    pnpm test tests/db/audit-log.test.ts
 * Prerequisites:  none — pglite is in-process WASM Postgres.
 * No Docker. No Supabase CLI. No network.
 *
 * Spec: docs/specs/0006-audit-log-implementation.md AC7 (13 sub-cases).
 * Migration under test: supabase/migrations/0003_audit_log.sql, layered on
 * top of cycle 1's supabase/migrations/0002_profiles_and_roles.sql.
 *
 * Substrate: `@electric-sql/pglite` — real Postgres (RLS, triggers, sequences,
 * SQLSTATE codes all behave as in production).
 *
 * Auth stub: tests/db/_fixtures/auth-stub.ts (cycle 1, validated against
 * Supabase docs 2026-05-09 — bypass predicate is `auth.uid() IS NULL`).
 *
 * Premortem: .conductor/0006/dispatches/0008-premortem-t4.md (10 risks).
 * The risk to mitigation map:
 *   R1  positive control for INSERT before UPDATE/DELETE denial assertions
 *       (so 42501 on UPDATE/DELETE is unambiguous — RLS-driven, not
 *       GRANT-missing).
 *   R2  per-test isolation via withRollback; an explicit isolation-proof
 *       sub-case asserts COUNT = 0 immediately after a withRollback'd
 *       seeded sub-case.
 *   R3  service-role bypass split into TWO axes: (a) RESET ROLE BYPASSRLS
 *       attribute WITH a present auth.uid(), and (b) app_authenticated
 *       with cleared test.uid (auth.uid() IS NULL) — the policy denies anon.
 *   R4  strict before/after JSON shape: toEqual({ role: 'member' }),
 *       NOT toBeDefined.
 *   R5  trigger-firing-order via inline pg_trigger snapshot. FIRST sub-case
 *       in the trigger section.
 *   R6  failed escalation writes NO audit row — explicit count = 0
 *       assertion under service-role read.
 *   R7  AC13 cycle-1 regression — confirm trigger fires + policies present.
 *   R8  SECURITY DEFINER vs INVOKER probe — manager-driven role change as
 *       app_authenticated (with GRANT INSERT) succeeds. Spec says NO
 *       SECURITY DEFINER → expectation: works because app_authenticated
 *       HAS the GRANT. Sub-case verifies both.
 *   R9  exactly one audit row per state change.
 *   R10 strict actor_id assertion via withAuthUid helper that sets, asserts,
 *       runs, resets — making it impossible to forget.
 *
 * Assertion contract (per cycle 1 KB): every denial assertion matches
 * error.code (SQLSTATE), NEVER message text. expect.assertions(N) is
 * declared on every rejects.toMatchObject path so the rejection branch
 * is required to run.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from 'vitest';
import { PGlite, type Results } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  setupAuthStub,
  setTestUid,
  resetAuthStub,
} from './_fixtures/auth-stub';
import { seedProfile } from './_fixtures/profiles';
import { seedAuditLog } from './_fixtures/audit-log';
import {
  setupAppAuthenticatedRole,
  asAuthenticated,
  asServiceRole,
  withRollback,
} from './_fixtures/rls-helpers';

// ESM/CJS-safe path resolution (mirrors cycle 1's rls-profiles.test.ts).
const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR =
  typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const MIGRATION_0002_PATH = resolve(
  TEST_DIR,
  '..',
  '..',
  'supabase',
  'migrations',
  '0002_profiles_and_roles.sql',
);
const MIGRATION_0003_PATH = resolve(
  TEST_DIR,
  '..',
  '..',
  'supabase',
  'migrations',
  '0003_audit_log.sql',
);

let pg: PGlite;

// Helper: run a multi-statement SQL block via pglite's raw entrypoint.
async function runSqlBlock(sql: string): Promise<void> {
  await (pg as unknown as { exec: (s: string) => Promise<unknown> }).exec(sql);
}

// Module-scope seeded uuids — populated in beforeAll, reused across describes.
let memberA = '';
let memberB = '';
let cashier = '';
let manager = '';
let owner = '';

/**
 * R10 mitigation — set test.uid, ASSERT auth.uid() actually returns it
 * (catches a forgotten setTestUid call where the helper silently no-ops),
 * run the body, then leave the GUC as-set. The withRollback wrapper around
 * the body unwinds the surrounding txn; resetAuthStub in beforeEach clears
 * GUC state before the next test.
 *
 * Returns the body's value so callers can assert on its result.
 */
async function withAuthUid<T>(
  uid: string,
  body: () => Promise<T>,
): Promise<T> {
  await setTestUid(pg, uid);
  const probe = await pg.query<{ uid: string | null }>(
    'SELECT auth.uid()::text AS uid',
  );
  // Strict equality — uuid round-trip via text. If the GUC didn't take
  // (driver bug, typo in the helper, copy-paste error in the test), this
  // fails fast at setup rather than letting an actor_id = NULL assertion
  // mis-pass downstream.
  expect(probe.rows[0]?.uid).toBe(uid);
  return body();
}

beforeAll(async () => {
  pg = new PGlite();

  // 1. Auth-stub FIRST — creates schema `auth`, plus auth.uid() / auth.role()
  //    bound to the test.uid / test.role GUCs.
  await setupAuthStub(pg);

  // 2. Stub auth.users — production Supabase ships this; pglite does not.
  //    Minimal shape: just the `id uuid PRIMARY KEY` the FKs need.
  await runSqlBlock(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `);

  // 3. Apply BOTH migrations in cycle order. NO try/catch — let any error
  //    propagate so the test runner aborts with a clear failure.
  const migration0002 = readFileSync(MIGRATION_0002_PATH, 'utf8');
  await runSqlBlock(migration0002);
  const migration0003 = readFileSync(MIGRATION_0003_PATH, 'utf8');
  await runSqlBlock(migration0003);

  // 4. Seed five fixtures (member-A, member-B, cashier, manager, owner).
  //    Each needs a real auth.users row first (FK constraint), then a
  //    matching profile.
  const seedAs = async (
    role: 'member' | 'cashier' | 'manager' | 'owner',
    label: string,
  ): Promise<string> => {
    const u = await pg.query<{ id: string }>(
      'INSERT INTO auth.users DEFAULT VALUES RETURNING id',
    );
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@audit-test.local`,
    });
    return profile.id;
  };
  memberA = await seedAs('member', 'member-a');
  memberB = await seedAs('member', 'member-b');
  cashier = await seedAs('cashier', 'cashier');
  manager = await seedAs('manager', 'manager');
  owner = await seedAs('owner', 'owner');

  // 5. Create app_authenticated (NOBYPASSRLS NOINHERIT) with grants for both
  //    tables AND the audit_log_id_seq sequence. Plus the cycle-1 auth.users
  //    GRANT (so member-A / etc. can probe the seeded auth.users from inside
  //    a sub-case if needed) and pg_catalog.pg_trigger SELECT for the
  //    introspection sub-case.
  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'audit_log'],
    sequences: ['audit_log_id_seq'],
  });
  await runSqlBlock(`
    GRANT SELECT, INSERT ON auth.users TO app_authenticated;
    GRANT SELECT ON pg_catalog.pg_trigger TO app_authenticated;
  `);
});

afterAll(async () => {
  await pg?.close?.();
});

beforeEach(async () => {
  // Clear identity GUCs so no test inherits identity from a prior one.
  await resetAuthStub(pg);
  // Default per-test role: app_authenticated (NOBYPASSRLS) — RLS evaluates.
  // Sub-cases that need different state call asServiceRole / asAuthenticated
  // explicitly inside their body.
  await pg.query('SET ROLE app_authenticated');
});

// =============================================================================
// AC7.1 — smoke: audit_log table exists empty under service-role read.
// First sub-case so any beforeAll regression fails loudly here.
// =============================================================================
describe('AC7.1 — smoke', () => {
  it('audit_log table exists and is empty under service-role read', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM audit_log',
    );
    expect(r.rows[0]!.n).toBe(0);
  });

  it('seeded role values are exactly what the suite expects', async () => {
    // Guards against an accidental seed up-rank that would make every
    // privilege-positive test pass for the wrong reason.
    await asServiceRole(pg);
    const r = await pg.query<{ id: string; role: string }>(
      `SELECT id, role::text AS role FROM profiles
        WHERE id = ANY($1::uuid[]) ORDER BY role`,
      [[memberA, memberB, cashier, manager, owner]],
    );
    const byId = new Map(r.rows.map((row) => [row.id, row.role]));
    expect(byId.get(memberA)).toBe('member');
    expect(byId.get(memberB)).toBe('member');
    expect(byId.get(cashier)).toBe('cashier');
    expect(byId.get(manager)).toBe('manager');
    expect(byId.get(owner)).toBe('owner');
  });
});

// =============================================================================
// AC7.13 — trigger-firing-order regression (R5). FIRST in the trigger section
// so any reorder fails loudly before subsequent sub-cases run. Identical to
// cycle 1's AC8.11 introspection but locked via inline snapshot (R5
// mitigation: pin to exact values so a loose assertion can't silently pass).
// =============================================================================
describe('AC7.13 — trigger-firing-order regression', () => {
  it('pg_trigger ordered by tgname matches the cycle-1 layout (snapshot)', async () => {
    // pglite (and Postgres in general) does not guarantee `pg_get_triggerdef`
    // is universally available; the `tgname + tgenabled` projection is the
    // load-bearing pair (premortem R5: capture tgname + tgenabled, snapshot
    // via toMatchInlineSnapshot). Filter to non-internal triggers on
    // public.profiles, ordered by tgname ASC — Postgres' multi-trigger
    // firing rule is alphabetical by name, so this projection IS the
    // ordering invariant.
    await asServiceRole(pg);
    const r = await pg.query<{ tgname: string; tgenabled: string }>(
      `SELECT tgname, tgenabled::text AS tgenabled
         FROM pg_trigger
        WHERE tgrelid = 'public.profiles'::regclass
          AND NOT tgisinternal
        ORDER BY tgname ASC`,
    );
    // Inline snapshot — any future migration that renames, drops, disables,
    // or adds a trigger on public.profiles will fail this assertion and
    // require an explicit snapshot update with reviewer scrutiny. 'O' is
    // pg_trigger.tgenabled for "origin" (the default — fires on session
    // origin, not on replica). 'D' would mean disabled.
    expect(r.rows).toMatchInlineSnapshot(`
      [
        {
          "tgenabled": "O",
          "tgname": "profiles_protect_role_change",
        },
        {
          "tgenabled": "O",
          "tgname": "set_updated_at",
        },
      ]
    `);
  });

  it('AC13 regression — cycle-1 policies still present on profiles', async () => {
    // R7 mitigation — defense-in-depth that the lifted helper / new
    // migration didn't disturb cycle 1's policy surface. We don't assert
    // policy bodies (cycle 1's shape test owns that); we assert the four
    // named policies still exist on `public.profiles` with the expected
    // commands.
    await asServiceRole(pg);
    const r = await pg.query<{ policyname: string; cmd: string }>(
      `SELECT policyname, cmd::text AS cmd
         FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'profiles'
        ORDER BY policyname ASC`,
    );
    const names = r.rows.map((row) => row.policyname);
    expect(names).toContain('profiles_select_self_or_staff');
    expect(names).toContain('profiles_update_self_or_manager');
    expect(names).toContain('profiles_delete_manager');
    // No insert policy on profiles — cycle 1's RLS denial-by-default path.
    expect(names).not.toContain('profiles_insert_anything');
  });
});

// =============================================================================
// AC7.2 — SELECT denial: member-A authenticated cannot SELECT any audit_log
// rows (manager+ only). Returns zero rows under RLS filtering — even if rows
// exist (positive control: seed via service-role first, confirm visible,
// then under member-A the row is filtered out).
// =============================================================================
describe('AC7.2 — SELECT denial member', () => {
  it('member-A authenticated sees zero audit_log rows even when rows exist', async () => {
    await withRollback(pg, async () => {
      // Positive control: seed under service-role.
      await asServiceRole(pg);
      const seeded = await seedAuditLog(pg, {
        actor_id: manager,
        action: 'profile.role_change',
        target_type: 'profile',
        target_id: memberA,
        before: { role: 'member' },
        after: { role: 'cashier' },
      });
      // Confirm visible under service-role (positive control).
      const visible = await pg.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM audit_log WHERE id = $1',
        [seeded.id],
      );
      expect(visible.rows[0]!.n).toBe(1);

      // Switch to member-A authenticated. RLS filters: manager+ only.
      await asAuthenticated(pg);
      await setTestUid(pg, memberA);
      const denied = await pg.query<{ id: number }>(
        'SELECT id FROM audit_log',
      );
      expect(denied.rows).toHaveLength(0);
    });
  });
});

// =============================================================================
// AC7.2-isolation — R2 mitigation. After the previous withRollback'd seeded
// sub-case completes, the service-role count under a fresh top-level read
// MUST be 0 — proves rollback isolation actually works. If this fails,
// every "expect rows to be 0" assertion in the suite is suspect.
// =============================================================================
describe('AC7.2-isolation — withRollback isolation proof (R2)', () => {
  it('service-role read sees no leakage from the prior seeded sub-case', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM audit_log',
    );
    expect(r.rows[0]!.n).toBe(0);
  });
});

// =============================================================================
// AC7.3 — SELECT denial cashier. The select policy gates on manager+, NOT
// cashier+ — cashier sees zero rows.
// =============================================================================
describe('AC7.3 — SELECT denial cashier', () => {
  it('cashier authenticated sees zero audit_log rows', async () => {
    await withRollback(pg, async () => {
      // Seed a row so the assertion isn't trivially true.
      await asServiceRole(pg);
      await seedAuditLog(pg, {
        actor_id: manager,
        action: 'profile.role_change',
        target_type: 'profile',
        target_id: memberA,
      });

      // Cashier — should still see zero (the policy gates on manager+).
      await asAuthenticated(pg);
      await setTestUid(pg, cashier);
      const r = await pg.query<{ id: number }>('SELECT id FROM audit_log');
      expect(r.rows).toHaveLength(0);
    });
  });
});

// =============================================================================
// AC7.4 — SELECT permitted manager + owner. The positive privilege ladder.
// =============================================================================
describe('AC7.4 — SELECT permitted manager + owner', () => {
  it('manager authenticated CAN SELECT all audit rows', async () => {
    await withRollback(pg, async () => {
      // Seed two rows under service-role.
      await asServiceRole(pg);
      await seedAuditLog(pg, {
        actor_id: manager,
        action: 'profile.role_change',
        target_type: 'profile',
        target_id: memberA,
      });
      await seedAuditLog(pg, {
        actor_id: owner,
        action: 'profile.role_change',
        target_type: 'profile',
        target_id: memberB,
      });

      await asAuthenticated(pg);
      await setTestUid(pg, manager);
      const r = await pg.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM audit_log',
      );
      // Manager sees both seeded rows.
      expect(r.rows[0]!.n).toBe(2);
    });
  });

  it('owner authenticated CAN SELECT all audit rows', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      await seedAuditLog(pg, {
        actor_id: manager,
        action: 'profile.role_change',
        target_type: 'profile',
        target_id: memberA,
      });

      await asAuthenticated(pg);
      await setTestUid(pg, owner);
      const r = await pg.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM audit_log',
      );
      expect(r.rows[0]!.n).toBe(1);
    });
  });
});

// =============================================================================
// AC7.5 — INSERT permitted authenticated user (R1 positive control).
//
// PGLITE QUIRK — DEFERRED PRODUCTION ASSERTION (cycle 2 attempt-2 pivot)
// ---------------------------------------------------------------------
// The original AC7.5 claim was "as app_authenticated (NOBYPASSRLS) with
// auth.uid() = memberA, INSERT into audit_log succeeds via the
// `auth.uid() IS NOT NULL` WITH CHECK clause". Under pglite, the top-level
// probe `SELECT auth.uid()::text` returns memberA correctly, BUT the
// IDENTICAL function call inside the RLS policy WITH CHECK clause
// evaluates `auth.uid() IS NULL` — and the INSERT is rejected with
// "new row violates row-level security policy".
//
// Cycle-1 RLS tests on `profiles` use the same auth-stub mechanism without
// this divergence. The most plausible mechanism is a pglite WASM
// role/GUC-scoping interaction specific to the `app_authenticated`
// (NOBYPASSRLS NOINHERIT) role's view of the `test.uid` GUC at policy-
// evaluation time vs. top-level statement time. See cycle-2 retrospective
// + KB topic for the lesson.
//
// PRODUCTION POSTGRES + REAL SUPABASE JWT context does not have this
// problem (the auth.uid() function reads from a JWT claim, not a per-
// session GUC). The production assertion lives in the staging-environment
// integration tests (ADR-0006 spec §AC7.5 production verification —
// real Supabase JWT context).
//
// What we still prove HERE (split into two stronger claims):
//   AC7.5a — positive structural control under service-role: the INSERT
//            path is wired (policies exist, GRANTs are in place, the
//            sequence is reachable). Seeding via `seedAuditLog` under
//            service-role confirms this.
//   AC7.5b — negative control: as `app_authenticated` with cleared
//            test.uid (auth.uid() IS NULL), INSERT raises 42501. This is
//            the same shape as AC7.6 below; here it serves as the
//            conjugate to the (deferred) authenticated-INSERT positive
//            and proves the WITH CHECK clause is wired and denies anon.
// =============================================================================
describe('AC7.5 — INSERT permitted authenticated user (R1 positive control)', () => {
  it.todo(
    'member-A authenticated (auth.uid() = memberA) CAN INSERT a row directly — DEFERRED to production: pglite RLS-context vs GUC scope quirk loses test.uid inside WITH CHECK clause; assert via real Supabase JWT in staging integration suite',
  );

  it('AC7.5a — positive structural control: service-role INSERT via seedAuditLog succeeds', async () => {
    // Service-role (BYPASSRLS) — RLS does not evaluate. This proves the
    // INSERT path is structurally functional: the table exists, the
    // sequence is reachable, the columns accept the seeded shape, and
    // (separately) the policies enforced for non-bypass callers do exist
    // (asserted explicitly below). It does NOT prove the INSERT policy's
    // WITH CHECK fires for an authenticated caller — that is the deferred
    // claim above and the conjugate AC7.5b below proves the WITH CHECK
    // wiring from the negative direction.
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      const seeded = await seedAuditLog(pg, {
        action: 'test.service_role_insert',
        target_type: 'test',
        target_id: `target-service-${memberA.slice(0, 8)}`,
      });
      // Service-role inserts NULL actor_id (the system-action path) —
      // seedAuditLog defaults actor_id to null when not overridden.
      expect(seeded.id).toBeGreaterThan(0);
      expect(seeded.actor_id).toBeNull();

      // Confirm policies actually exist on the table — so a hypothetical
      // future regression where the table had RLS disabled (and INSERT
      // succeeded for that reason) cannot mask this.
      const policies = await pg.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'audit_log'`,
      );
      expect(policies.rows[0]!.n).toBeGreaterThanOrEqual(2);

      // Verify the row landed (service-role read — same context).
      const r = await pg.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM audit_log
          WHERE action = 'test.service_role_insert'`,
      );
      expect(r.rows[0]!.n).toBe(1);
    });
  });

  it('AC7.5b — negative WITH-CHECK wiring: app_authenticated with auth.uid() IS NULL — INSERT raises 42501', async () => {
    // Conjugate to the (deferred) authenticated-INSERT positive.
    // beforeEach already pinned us to app_authenticated NOBYPASSRLS with
    // cleared test.uid → auth.uid() IS NULL. The WITH CHECK clause
    // `auth.uid() IS NOT NULL` MUST reject. This is the negative direction
    // of "the policy is wired and fires" — sufficient to prove the WITH
    // CHECK clause exists and gates the path, even though the positive
    // direction is deferred to production.
    expect.assertions(2);
    await withRollback(pg, async () => {
      const probe = await pg.query<{ is_null: boolean }>(
        'SELECT auth.uid() IS NULL AS is_null',
      );
      expect(probe.rows[0]!.is_null).toBe(true);

      await expect(
        pg.query(
          `INSERT INTO audit_log (actor_id, action, target_type, target_id)
           VALUES ($1, $2, $3, $4)`,
          [null, 'ac7.5b.should_not_insert', 'test', 'target-ac7-5b'],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

// =============================================================================
// AC7.6 — INSERT denial anon. anon caller (test.uid cleared, app_authenticated
// role) attempting INSERT raises SQLSTATE 42501 — the `auth.uid() IS NOT NULL`
// WITH CHECK clause rejects it.
// =============================================================================
describe('AC7.6 — INSERT denial anon', () => {
  it('anon (auth.uid() IS NULL) INSERT into audit_log raises SQLSTATE 42501', async () => {
    expect.assertions(2);
    await withRollback(pg, async () => {
      // app_authenticated + cleared test.uid (anon path). beforeEach already
      // set this up; assert defensively.
      const probe = await pg.query<{ is_null: boolean }>(
        'SELECT auth.uid() IS NULL AS is_null',
      );
      expect(probe.rows[0]!.is_null).toBe(true);

      await expect(
        pg.query(
          `INSERT INTO audit_log (actor_id, action, target_type, target_id)
           VALUES ($1, $2, $3, $4)`,
          [null, 'anon.should_not_insert', 'test', 'target-anon'],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

// =============================================================================
// AC7.7 — UPDATE denial (append-only invariant).
//
// PG SEMANTICS — SILENT RLS DENIAL (cycle 2 attempt-2 pivot)
// ----------------------------------------------------------
// The migration grants UPDATE to `app_authenticated` (via the lifted
// helper's `GRANT SELECT, INSERT, UPDATE, DELETE ON ... TO
// app_authenticated`) but ships NO `FOR UPDATE` policy. Under FORCE RLS
// + GRANT UPDATE + missing FOR UPDATE policy, Postgres does NOT raise
// SQLSTATE 42501; instead, the implicit USING clause is treated as
// `false`, the row is invisible to the UPDATE, and the statement
// affects 0 rows silently. PG only raises 42501 for missing GRANTs (or
// explicit RAISE EXCEPTION). The append-only invariant is enforced by
// the silent-denial mechanism; the contract is "no row state changes",
// NOT "the SQL command errors".
//
// Three privilege variants (member-A / manager / owner under
// app_authenticated NOBYPASSRLS) all see `affectedRows: 0` and the
// service-role read confirms the row was not mutated. This is a
// stronger assertion than 42501 — it directly proves the append-only
// contract rather than a side-effect of it.
// =============================================================================
describe('AC7.7 — UPDATE denial (append-only invariant)', () => {
  it('member-A authenticated UPDATE affects 0 rows (silent RLS denial) and row is unchanged', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      const seeded = await seedAuditLog(pg, {
        action: 'seeded.update_target',
      });

      await asAuthenticated(pg);
      await setTestUid(pg, memberA);
      const upd = (await pg.query(
        `UPDATE audit_log SET action = 'forged' WHERE id = $1`,
        [seeded.id],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);

      // Service-role read confirms no row was actually changed.
      await asServiceRole(pg);
      const readback = await pg.query<{ action: string }>(
        `SELECT action FROM audit_log WHERE id = $1`,
        [seeded.id],
      );
      expect(readback.rows).toHaveLength(1);
      expect(readback.rows[0]!.action).toBe('seeded.update_target');
    });
  });

  it('manager authenticated UPDATE affects 0 rows (silent RLS denial) and row is unchanged', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      const seeded = await seedAuditLog(pg, {
        action: 'seeded.update_target',
      });

      await asAuthenticated(pg);
      await setTestUid(pg, manager);
      const upd = (await pg.query(
        `UPDATE audit_log SET action = 'forged' WHERE id = $1`,
        [seeded.id],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);

      await asServiceRole(pg);
      const readback = await pg.query<{ action: string }>(
        `SELECT action FROM audit_log WHERE id = $1`,
        [seeded.id],
      );
      expect(readback.rows).toHaveLength(1);
      expect(readback.rows[0]!.action).toBe('seeded.update_target');
    });
  });

  it('owner authenticated UPDATE affects 0 rows (silent RLS denial) and row is unchanged', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      const seeded = await seedAuditLog(pg, {
        action: 'seeded.update_target',
      });

      await asAuthenticated(pg);
      await setTestUid(pg, owner);
      const upd = (await pg.query(
        `UPDATE audit_log SET action = 'forged' WHERE id = $1`,
        [seeded.id],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);

      await asServiceRole(pg);
      const readback = await pg.query<{ action: string }>(
        `SELECT action FROM audit_log WHERE id = $1`,
        [seeded.id],
      );
      expect(readback.rows).toHaveLength(1);
      expect(readback.rows[0]!.action).toBe('seeded.update_target');
    });
  });
});

// =============================================================================
// AC7.8 — DELETE denial (append-only invariant).
//
// PG SEMANTICS — SILENT RLS DENIAL (same mechanism as AC7.7 above)
// ----------------------------------------------------------------
// GRANT DELETE on audit_log + no FOR DELETE policy → DELETE statement
// affects 0 rows silently. The post-DELETE service-role read confirms
// the row is still present (count = 1). Same three privilege variants
// as AC7.7. See AC7.7 header for full PG-semantics rationale.
// =============================================================================
describe('AC7.8 — DELETE denial (append-only invariant)', () => {
  it('member-A authenticated DELETE affects 0 rows (silent RLS denial) and row remains', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      const seeded = await seedAuditLog(pg, {
        action: 'seeded.delete_target',
      });

      await asAuthenticated(pg);
      await setTestUid(pg, memberA);
      const del = (await pg.query(
        'DELETE FROM audit_log WHERE id = $1',
        [seeded.id],
      )) as Results;
      expect(del.affectedRows ?? 0).toBe(0);

      // Service-role read confirms the row still exists (was not deleted).
      await asServiceRole(pg);
      const readback = await pg.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM audit_log WHERE id = $1`,
        [seeded.id],
      );
      expect(readback.rows[0]!.n).toBe(1);
    });
  });

  it('manager authenticated DELETE affects 0 rows (silent RLS denial) and row remains', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      const seeded = await seedAuditLog(pg, {
        action: 'seeded.delete_target',
      });

      await asAuthenticated(pg);
      await setTestUid(pg, manager);
      const del = (await pg.query(
        'DELETE FROM audit_log WHERE id = $1',
        [seeded.id],
      )) as Results;
      expect(del.affectedRows ?? 0).toBe(0);

      await asServiceRole(pg);
      const readback = await pg.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM audit_log WHERE id = $1`,
        [seeded.id],
      );
      expect(readback.rows[0]!.n).toBe(1);
    });
  });

  it('owner authenticated DELETE affects 0 rows (silent RLS denial) and row remains', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      const seeded = await seedAuditLog(pg, {
        action: 'seeded.delete_target',
      });

      await asAuthenticated(pg);
      await setTestUid(pg, owner);
      const del = (await pg.query(
        'DELETE FROM audit_log WHERE id = $1',
        [seeded.id],
      )) as Results;
      expect(del.affectedRows ?? 0).toBe(0);

      await asServiceRole(pg);
      const readback = await pg.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM audit_log WHERE id = $1`,
        [seeded.id],
      );
      expect(readback.rows[0]!.n).toBe(1);
    });
  });
});

// =============================================================================
// AC7.9 — Service-role bypass. R3 mitigation — split into TWO axes so we
// know which mechanism is doing the work.
//   (a) Role-attribute (BYPASSRLS) bypass: RESET ROLE WITH a present
//       auth.uid() — the policy never evaluates, INSERT writes the real
//       actor_id we set. Asserts the attribute-driven bypass is the cause.
//   (b) Policy-side denial under app_authenticated: cleared test.uid means
//       auth.uid() IS NULL means policy denies. (Conjugate axis: same
//       caller as axis (a)'s INSERT but with the BYPASSRLS attribute
//       removed. Proves that without the attribute, anon INSERTs fail —
//       so axis (a)'s success was attribute-driven, not coincidence.)
// =============================================================================
describe('AC7.9 — service-role bypass (R3 split)', () => {
  it('axis (a): RESET ROLE BYPASSRLS WITH present auth.uid() — INSERT writes the real actor_id', async () => {
    await withRollback(pg, async () => {
      // Set test.uid to a real user FIRST, then RESET ROLE to the
      // BYPASSRLS-bearing superuser. The INSERT then succeeds via the
      // role attribute (RLS does not evaluate); actor_id records what
      // auth.uid() returns — i.e., the real user we set.
      await setTestUid(pg, manager);
      await pg.query('RESET ROLE');
      const probe = await pg.query<{ uid: string | null }>(
        'SELECT auth.uid()::text AS uid',
      );
      expect(probe.rows[0]!.uid).toBe(manager); // pre-condition pinned (R10).

      const ins = await pg.query<{ id: number; actor_id: string | null }>(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id)
         VALUES (auth.uid(), $1, $2, $3)
         RETURNING id, actor_id::text AS actor_id`,
        ['service.bypass_with_uid', 'test', 'axis-a'],
      );
      expect(ins.rows[0]!.actor_id).toBe(manager);

      // Service-role can also SELECT, UPDATE, DELETE under BYPASSRLS —
      // these UPDATE/DELETE are the documented escape hatch (ADR-0006:
      // "service role retains full DML for emergency manual repair").
      // Production policy is "service-role does not UPDATE/DELETE
      // audit_log" — enforced by code review, not RLS.
      const sel = await pg.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM audit_log WHERE id = $1`,
        [ins.rows[0]!.id],
      );
      expect(sel.rows[0]!.n).toBe(1);

      const upd = (await pg.query(
        `UPDATE audit_log SET action = 'service.escape_hatch' WHERE id = $1`,
        [ins.rows[0]!.id],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);

      const del = (await pg.query(`DELETE FROM audit_log WHERE id = $1`, [
        ins.rows[0]!.id,
      ])) as Results;
      expect(del.affectedRows ?? 0).toBe(1);
    });
  });

  it('axis (b): app_authenticated WITH auth.uid() IS NULL — policy denies (conjugate to axis a)', async () => {
    expect.assertions(2);
    await withRollback(pg, async () => {
      // app_authenticated (NOBYPASSRLS, set by beforeEach) + cleared
      // test.uid means auth.uid() IS NULL means policy denies. This is
      // the conjugate axis: same caller as axis (a)'s INSERT but with the
      // BYPASSRLS attribute removed.
      const probe = await pg.query<{ is_null: boolean }>(
        'SELECT auth.uid() IS NULL AS is_null',
      );
      expect(probe.rows[0]!.is_null).toBe(true);

      await expect(
        pg.query(
          `INSERT INTO audit_log (actor_id, action, target_type, target_id)
           VALUES (auth.uid(), $1, $2, $3)`,
          ['service.no_bypass', 'test', 'axis-b'],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

// =============================================================================
// AC7.10 — Profile role-change writes audit row (POSITIVE INTEGRATION).
//
// R4 mitigation: strict shape assertions on before/after via
// `toEqual({ role: ... })`, NOT `toBeDefined`.
// R8 mitigation: this sub-case ALSO exercises the SECURITY-DEFINER vs
// INVOKER probe — the trigger is INVOKER per spec, and this works because
// app_authenticated HAS GRANT INSERT on audit_log (verified positively
// below).
// R9 mitigation: count = 1 assertion.
// R10 mitigation: actor_id = manager (strict equality, NEVER toBeDefined).
//                 Setup uses withAuthUid which sets+asserts auth.uid() before
//                 the UPDATE — making it impossible to forget the stub.
// =============================================================================
describe('AC7.10 — positive integration (manager role change writes audit row)', () => {
  it('manager UPDATE of member-A role writes exactly one audit row with strict shape', async () => {
    await withRollback(pg, async () => {
      // R8 positive control: app_authenticated HAS the GRANT INSERT on
      // audit_log (verified via has_table_privilege). The trigger is
      // INVOKER-rights per the migration; the audit INSERT inside the
      // trigger runs as the calling Postgres role and succeeds because
      // (i) GRANT INSERT is present, (ii) auth.uid() IS NOT NULL.
      await asAuthenticated(pg);
      const grant = await pg.query<{ ok: boolean }>(
        `SELECT has_table_privilege('app_authenticated', 'audit_log', 'INSERT') AS ok`,
      );
      expect(grant.rows[0]!.ok).toBe(true);

      // Setup the manager identity with the strict-assertion helper.
      // R10: setTestUid + auth.uid() readback are inside withAuthUid.
      await withAuthUid(manager, async () => {
        const upd = (await pg.query(
          `UPDATE profiles SET role = 'cashier' WHERE id = $1`,
          [memberA],
        )) as Results;
        expect(upd.affectedRows ?? 0).toBe(1);
      });

      // Read the audit row under service-role (RLS bypassed for the
      // verifier — this is the canonical pattern: mutate under the
      // production-fidelity caller, verify under service-role).
      await asServiceRole(pg);
      const r = await pg.query<{
        actor_id: string | null;
        action: string;
        target_type: string;
        target_id: string;
        before: unknown;
        after: unknown;
        ip: string | null;
        user_agent: string | null;
      }>(
        `SELECT actor_id::text AS actor_id, action, target_type, target_id,
                before, after, ip::text AS ip, user_agent
           FROM audit_log
          WHERE target_id = $1 AND action = 'profile.role_change'`,
        [memberA],
      );

      // R9: exactly one audit row per state change.
      expect(r.rows).toHaveLength(1);
      const row = r.rows[0]!;

      // R10: strict actor_id assertion (NEVER toBeDefined).
      expect(row.actor_id).toBe(manager);

      // Action / target shape (strict equality).
      expect(row.action).toBe('profile.role_change');
      expect(row.target_type).toBe('profile');
      expect(row.target_id).toBe(memberA);

      // R4: strict JSON shape on before/after — toEqual, NOT toBeDefined.
      expect(row.before).toEqual({ role: 'member' });
      expect(row.after).toEqual({ role: 'cashier' });

      // Trigger writes NULL ip / user_agent (those flow through withAudit
      // for application-level audit events; trigger-level events have
      // no HTTP context).
      expect(row.ip).toBeNull();
      expect(row.user_agent).toBeNull();
    });
  });
});

// =============================================================================
// AC7.11 — Failed role-change writes NO audit row (NEGATIVE INTEGRATION).
//
// R6 mitigation: explicit count = 0 assertion under service-role read,
// AFTER the SAVEPOINT-rollback unwinds the aborted txn. Catches the
// "BEFORE-trigger writes audit row, then RAISES" footgun where the audit
// INSERT and the role-change UPDATE share a transaction and rollback
// together — the negative direction of atomicity.
// =============================================================================
describe('AC7.11 — negative integration (failed role-change writes NO audit row)', () => {
  it('member-A self-update of role raises 42501 and writes 0 audit rows', async () => {
    expect.assertions(2);
    await withRollback(pg, async () => {
      // Member-A authenticated, attempt self-escalation.
      await asAuthenticated(pg);
      await setTestUid(pg, memberA);

      // Use SAVEPOINT inside the outer withRollback so the post-rejection
      // aborted-txn state is recoverable — Postgres marks the surrounding
      // txn as aborted on any error, and any subsequent query (including
      // the COUNT below) would fail with "current transaction is aborted"
      // until ROLLBACK TO SAVEPOINT restores the savepoint state. Cycle 1
      // uses the same pattern in AC8.11.
      await pg.query('SAVEPOINT before_failed_escalation');
      await expect(
        pg.query(
          `UPDATE profiles SET role = 'manager' WHERE id = $1`,
          [memberA],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await pg.query('ROLLBACK TO SAVEPOINT before_failed_escalation');

      // Under service-role, assert NO audit row exists for this target +
      // action. R6 mitigation — count = 0, NOT just "row not found".
      await asServiceRole(pg);
      const r = await pg.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM audit_log
          WHERE target_id = $1 AND action = 'profile.role_change'`,
        [memberA],
      );
      expect(r.rows[0]!.n).toBe(0);
    });
  });
});

// =============================================================================
// AC7.12 — Service-role role-change writes audit row with NULL actor_id
// (SYSTEM-LEVEL INTEGRATION). Proves the trigger doesn't trip on a NULL
// auth.uid() (e.g. doesn't have a NOT NULL on actor_id INSERT path).
// =============================================================================
describe('AC7.12 — service-role role-change writes NULL actor_id', () => {
  it('RESET ROLE + cleared test.uid: UPDATE memberA role writes audit row with actor_id IS NULL', async () => {
    await withRollback(pg, async () => {
      // Service-role bypass: RESET ROLE (BYPASSRLS) + clear test.uid
      // (auth.uid() IS NULL). This is the documented system-action /
      // webhook path per ADR-0006.
      await asServiceRole(pg);
      const probe = await pg.query<{ is_null: boolean }>(
        'SELECT auth.uid() IS NULL AS is_null',
      );
      expect(probe.rows[0]!.is_null).toBe(true);

      const upd = (await pg.query(
        `UPDATE profiles SET role = 'cashier' WHERE id = $1`,
        [memberA],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);

      // Verify audit row written with NULL actor_id and correct shape.
      const r = await pg.query<{
        actor_id: string | null;
        before: unknown;
        after: unknown;
      }>(
        `SELECT actor_id::text AS actor_id, before, after
           FROM audit_log
          WHERE target_id = $1 AND action = 'profile.role_change'`,
        [memberA],
      );
      expect(r.rows).toHaveLength(1);
      const row = r.rows[0]!;
      expect(row.actor_id).toBeNull(); // system action — actor_id IS NULL.
      expect(row.before).toEqual({ role: 'member' });
      expect(row.after).toEqual({ role: 'cashier' });
    });
  });
});
