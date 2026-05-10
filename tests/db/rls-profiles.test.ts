/**
 * RLS unit tests for `profiles` (ADR-0003 slice 1, spec AC8 + AC5).
 *
 * Run locally:    pnpm test tests/db/rls-profiles.test.ts
 * Prerequisites:  none — pglite is in-process WASM Postgres.
 * No Docker. No Supabase CLI. No network.
 *
 * Spec: docs/specs/0003-authorization-rls-implementation.md AC8 (12 sub-cases)
 * + AC5 (4×4 ladder matrix). Migration under test:
 * supabase/migrations/0002_profiles_and_roles.sql.
 *
 * Substrate: @electric-sql/pglite (real Postgres compiled to WASM — RLS,
 * triggers, sequences, SQLSTATE codes all behave as in production).
 *
 * Auth stub: tests/db/_fixtures/auth-stub.ts (validated 2026-05-09 against
 * Supabase docs; bypass predicate is `auth.uid() IS NULL`).
 *
 * Sub-case map (AC8):
 *    1. Cross-tenant SELECT denial (member-A cannot see member-B)
 *    2. Cross-tenant UPDATE denial (member-A cannot update member-B)
 *    3. Cross-tenant DELETE denial (member-A cannot delete any row)
 *    4. Cashier read (any-member-row visible to cashier)
 *    5. Manager write (manager can update any member's row, including role)
 *    6. auth.role_at_least 4×4 matrix (AC5)
 *    7. Anon SELECT — zero rows (RLS filters silently)
 *    8. Anon UPDATE / DELETE — zero rows affected
 *    9. Anon INSERT — SQLSTATE 42501 (no insert policy → RLS denies)
 *   10. Privilege-escalation: member-A self-update role raises 42501
 *       (3 variants: simple SET, multi-column SET, no-op SET role=role)
 *   11. Trigger-firing-order invariant — `updated_at` not advanced after a
 *       rolled-back unauthorized role change; pg_trigger introspection
 *       confirms profiles_protect_role_change sorts before set_updated_at.
 *   12. Service-role bypass: cleared test.uid permits role change.
 *   +.  WITH CHECK behavioral coverage (id-rewrite attempt rejected by RLS).
 *
 * Assertion contract (spec AC7): denial assertions match `error.code`, never
 * the message text. Every test that uses `rejects.toMatchObject` declares
 * `expect.assertions(N)` so the rejection branch is required to run.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PGlite, type Results } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupAuthStub, setTestUid, setTestRole, resetAuthStub } from './_fixtures/auth-stub';
import { seedProfile } from './_fixtures/profiles';
import {
  setupAppAuthenticatedRole,
  asAuthenticated,
  asServiceRole,
  withRollback,
} from './_fixtures/rls-helpers';

// Path resolution that works on Windows (backslash-safe via path.resolve).
// Some Node setups give us __dirname natively (CJS); under ESM we synthesize
// from import.meta.url. Either path is safe — both produce a Windows-native
// absolute path that readFileSync handles without further normalization.
const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const MIGRATION_PATH = resolve(
  TEST_DIR,
  '..',
  '..',
  'supabase',
  'migrations',
  '0002_profiles_and_roles.sql',
);

let pg: PGlite;

// Helper: run a multi-statement SQL block via pglite's raw entrypoint.
// Wrapping the call here keeps the rest of the file using `pg.query()` for
// parameterized single statements; this helper is the only place we use the
// multi-statement raw entrypoint (for migration application + minor schema
// setup like CREATE EXTENSION + the auth.users stub).
async function runSqlBlock(sql: string): Promise<void> {
  await (pg as unknown as { exec: (s: string) => Promise<unknown> }).exec(sql);
}

// Module-scope seeded uuids — populated in beforeAll, reused across describes.
// Two members so cross-tenant tests have distinct rows; one of each staff
// role for the cashier-read / manager-write / 4×4-ladder cases.
let memberA = '';
let memberB = '';
let cashier = '';
let manager = '';
let owner = '';

beforeAll(async () => {
  pg = new PGlite();

  // 1. Auth-stub FIRST — creates schema `auth`, plus auth.uid() / auth.role()
  //    bound to the test.uid / test.role GUCs. The migration depends on
  //    `auth.users(id)` existing as an FK target, so we create a minimal
  //    stub for that AFTER the auth schema exists but BEFORE the migration.
  await setupAuthStub(pg);

  // 2. Stub auth.users — production Supabase ships this; pglite does not.
  //    Minimal shape: just the `id uuid PRIMARY KEY` the FK in profiles
  //    needs to satisfy. Default-fill via gen_random_uuid() so we can
  //    INSERT DEFAULT VALUES and capture the generated id.
  await runSqlBlock(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `);

  // 3. Apply the migration. Read text and feed to pglite's raw-SQL entrypoint
  //    per spec AC1. NO try/catch — let any error propagate so the test
  //    runner aborts with a clear failure (premortem R9).
  const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
  await runSqlBlock(migrationSql);

  // 4. Seed five fixtures (member-A, member-B, cashier, manager, owner).
  //    Each needs a real auth.users row first (FK constraint), then a
  //    matching profile. Emails distinct-by-construction (premortem R15).
  const seedAs = async (
    role: 'member' | 'cashier' | 'manager' | 'owner',
    label: string,
  ): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@rls-test.local`,
    });
    return profile.id;
  };
  memberA = await seedAs('member', 'member-a');
  memberB = await seedAs('member', 'member-b');
  cashier = await seedAs('cashier', 'cashier');
  manager = await seedAs('manager', 'manager');
  owner = await seedAs('owner', 'owner');

  // 5. Create a non-superuser role that mirrors Supabase's `authenticated`
  //    role. pglite's default `postgres` user has BYPASSRLS, which
  //    short-circuits ALL policy evaluation regardless of `FORCE ROW LEVEL
  //    SECURITY` on the table. In production Supabase, the `authenticated`
  //    and `anon` roles do NOT have BYPASSRLS — they are subject to RLS.
  //    To match production semantics, every per-test query runs as
  //    `app_authenticated` (NOBYPASSRLS); seeding above ran as superuser,
  //    which mirrors how Supabase's service-role bypasses RLS for
  //    server-side seeds. The service-role bypass test (AC8.12) explicitly
  //    `RESET ROLE`s back to superuser to simulate that path.
  //
  //    auth.role_at_least() is SECURITY DEFINER (owned by superuser), so
  //    its inner SELECT on profiles bypasses RLS regardless of the caller's
  //    BYPASSRLS attribute — the EXECUTE grant below is sufficient for the
  //    4×4 ladder matrix (AC5) to work under app_authenticated.
  //
  //    pg_trigger / pg_class are world-readable in stock Postgres; the
  //    introspection grants below are defense-in-depth.
  //
  //    The role + standard schema/table/function grants are owned by the
  //    shared rls-helpers fixture so cycle 2 (audit_log) can re-use them
  //    without redefining the contract. The two cycle-1-specific grants
  //    that follow (auth.users seeding from app_authenticated, pg_trigger
  //    introspection for AC8.11) are NOT part of the shared default set
  //    and stay inlined here.
  await setupAppAuthenticatedRole(pg, { tables: ['profiles'] });
  await runSqlBlock(`
    GRANT SELECT, INSERT ON auth.users TO app_authenticated;
    GRANT SELECT ON pg_catalog.pg_trigger TO app_authenticated;
  `);
});

afterAll(async () => {
  // pglite has a close() method on the instance — guard for forwards-compat.
  await pg?.close?.();
});

beforeEach(async () => {
  // Clear both GUCs before every test so no test inherits identity from a
  // prior one (premortem R3, R17). Identity must always be set explicitly
  // by the test that uses it.
  await resetAuthStub(pg);

  // Switch to the NOBYPASSRLS role so RLS actually applies. Mirrors
  // Supabase's `authenticated` role (which lacks BYPASSRLS in production).
  // Tests that simulate service-role bypass (AC8.12) RESET ROLE explicitly
  // inside their body — beforeEach restores `app_authenticated` for the
  // next test.
  await pg.query('SET ROLE app_authenticated');
});

// withRollback / asServiceRole / asAuthenticated are imported from
// `./_fixtures/rls-helpers` (lifted in ADR-0006 cycle 2 t0 — see fixture file
// header). The shared helpers preserve cycle-1 semantics verbatim:
//   - withRollback: BEGIN / ROLLBACK pair (no SAVEPOINT, no commit-on-success).
//   - asServiceRole: RESET ROLE + resetAuthStub (clears both Postgres role
//     and auth.uid/auth.role GUCs).
//   - asAuthenticated: SET ROLE app_authenticated (cycle 1 callers pass no
//     uid/role; the helper accepts optional uid/role for cycle 2 reuse).

// =============================================================================
// SMOKE — the FIRST it() in the file. If this fails, every other failure is
// downstream and easy to diagnose. Catches a beforeAll silently failing
// (premortem R9). Also re-asserts the auth-stub's NULL-clearing semantics
// (premortem R17) so the bypass simulation is verified before we trust it.
// =============================================================================
describe('smoke', () => {
  it('beforeAll seeded the migration and 5 profiles', async () => {
    // Smoke verifies the seed worked — fundamentally a service-role/snapshot
    // read. Under the per-test app_authenticated role with auth.uid() = NULL
    // (cleared by resetAuthStub in beforeEach), RLS would filter every row
    // and COUNT returns 0. Switch to service-role for the count, then restore
    // app_authenticated so subsequent tests aren't surprised.
    await asServiceRole(pg);
    const r = await pg.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM profiles');
    expect(r.rows[0]!.n).toBeGreaterThanOrEqual(5);
    await asAuthenticated(pg);
  });

  it('auth.uid() returns NULL after resetAuthStub (bypass-predicate sanity)', async () => {
    await resetAuthStub(pg);
    const r = await pg.query<{ is_null: boolean }>('SELECT auth.uid() IS NULL AS is_null');
    expect(r.rows[0]!.is_null).toBe(true);
  });

  it('seeded role values are exactly what the suite expects (premortem R4)', async () => {
    // Sanity-read all five seeded profiles via service-role and confirm the
    // role column matches what beforeAll set. If the seed accidentally
    // up-ranked anyone, every privilege-positive test below would pass for
    // the wrong reason.
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
// AC8 sub-case 1 — cross-tenant SELECT denial.
// Pattern (premortem R1): positive control via service-role read, then
// switch to member-A and assert the row is filtered.
// =============================================================================
describe('AC8.1 — cross-tenant SELECT denial', () => {
  it('member-A authenticated cannot SELECT member-B row', async () => {
    // Positive control — prove member-B's row exists (service-role path).
    await asServiceRole(pg);
    const sentinel = await pg.query<{ id: string }>('SELECT id FROM profiles WHERE id = $1', [
      memberB,
    ]);
    expect(sentinel.rows).toHaveLength(1);

    // Switch to member-A and assert RLS filters member-B's row to zero.
    await asAuthenticated(pg);
    await setTestUid(pg, memberA);
    const denied = await pg.query<{ id: string }>('SELECT id FROM profiles WHERE id = $1', [
      memberB,
    ]);
    expect(denied.rows).toHaveLength(0);
  });

  it('member-A authenticated CAN SELECT their own row (positive)', async () => {
    await setTestUid(pg, memberA);
    const r = await pg.query<{ id: string }>('SELECT id FROM profiles WHERE id = $1', [memberA]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.id).toBe(memberA);
  });
});

// =============================================================================
// AC8 sub-case 2 — cross-tenant UPDATE denial.
// Pattern (premortem R2): assert before/after row IS unchanged via service-
// role read; rowCount=0 alone is ambiguous (could mean WHERE-mismatch).
// =============================================================================
describe('AC8.2 — cross-tenant UPDATE denial', () => {
  it('member-A authenticated cannot UPDATE member-B row', async () => {
    await withRollback(pg, async () => {
      // Snapshot member-B BEFORE under service-role.
      await asServiceRole(pg);
      const before = await pg.query<{
        full_name: string;
        updated_at: string;
      }>('SELECT full_name, updated_at FROM profiles WHERE id = $1', [memberB]);
      expect(before.rows).toHaveLength(1);

      // Attempt cross-tenant UPDATE under member-A.
      await asAuthenticated(pg);
      await setTestUid(pg, memberA);
      const upd = (await pg.query(`UPDATE profiles SET full_name = 'pwned' WHERE id = $1`, [
        memberB,
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);

      // Snapshot AFTER — same name, same updated_at (proves RLS filtered,
      // not just that WHERE matched no rows AND set_updated_at didn't fire).
      await asServiceRole(pg);
      const after = await pg.query<{
        full_name: string;
        updated_at: string;
      }>('SELECT full_name, updated_at FROM profiles WHERE id = $1', [memberB]);
      expect(after.rows[0]!.full_name).toBe(before.rows[0]!.full_name);
      expect(after.rows[0]!.updated_at).toEqual(before.rows[0]!.updated_at);
    });
  });
});

// =============================================================================
// AC8 sub-case 3 — cross-tenant DELETE denial.
// =============================================================================
describe('AC8.3 — cross-tenant DELETE denial', () => {
  it('member-A authenticated cannot DELETE any row', async () => {
    await withRollback(pg, async () => {
      // Positive control — member-B exists.
      await asServiceRole(pg);
      const before = await pg.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM profiles WHERE id = $1',
        [memberB],
      );
      expect(before.rows[0]!.n).toBe(1);

      // Attempt DELETE under member-A.
      await asAuthenticated(pg);
      await setTestUid(pg, memberA);
      const del = (await pg.query('DELETE FROM profiles WHERE id = $1', [memberB])) as Results;
      expect(del.affectedRows ?? 0).toBe(0);

      // After — member-B still present.
      await asServiceRole(pg);
      const after = await pg.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM profiles WHERE id = $1',
        [memberB],
      );
      expect(after.rows[0]!.n).toBe(1);
    });
  });

  it('member-A authenticated cannot DELETE their own row either', async () => {
    // delete policy is profiles_delete_manager — only manager+ may delete.
    // Members are not in the manager+ ladder, so even self-delete is denied.
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      const del = (await pg.query('DELETE FROM profiles WHERE id = $1', [memberA])) as Results;
      expect(del.affectedRows ?? 0).toBe(0);

      // Sanity — row still there.
      await asServiceRole(pg);
      const after = await pg.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM profiles WHERE id = $1',
        [memberA],
      );
      expect(after.rows[0]!.n).toBe(1);
    });
  });
});

// =============================================================================
// AC8 sub-case 4 — cashier read (positive privilege).
// Pattern (premortem R4): the cashier seed's role was already verified in
// the smoke test — proceed straight to the privileged action.
// =============================================================================
describe('AC8.4 — cashier read', () => {
  it('cashier authenticated CAN SELECT any member row', async () => {
    await setTestUid(pg, cashier);
    const r = await pg.query<{ id: string }>('SELECT id FROM profiles WHERE id = ANY($1::uuid[])', [
      [memberA, memberB],
    ]);
    // Both rows visible (cashier ladder permits SELECT).
    expect(r.rows.map((row) => row.id).sort()).toEqual([memberA, memberB].sort());
  });
});

// =============================================================================
// AC8 sub-case 5 — manager write (positive privilege, including role column).
// Wraps in withRollback so subsequent tests see the original role.
// =============================================================================
describe('AC8.5 — manager write', () => {
  it('manager authenticated CAN UPDATE any member row including the role column', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      const upd = (await pg.query(`UPDATE profiles SET role = 'cashier' WHERE id = $1`, [
        memberA,
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);

      // Verify post-state explicitly (premortem R7) — role actually changed.
      const after = await pg.query<{ role: string }>(
        'SELECT role::text AS role FROM profiles WHERE id = $1',
        [memberA],
      );
      expect(after.rows[0]!.role).toBe('cashier');
    });
  });

  it('manager authenticated CAN UPDATE non-role columns on any member row', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      const upd = (await pg.query(
        `UPDATE profiles SET full_name = 'Renamed By Manager' WHERE id = $1`,
        [memberA],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);

      const after = await pg.query<{ full_name: string }>(
        'SELECT full_name FROM profiles WHERE id = $1',
        [memberA],
      );
      expect(after.rows[0]!.full_name).toBe('Renamed By Manager');
    });
  });
});

// =============================================================================
// AC5 — auth.role_at_least 4×4 ladder matrix.
// Pattern (premortem R8): switch test.uid to each seeded caller-role profile;
// the production helper reads `profiles.role WHERE id = auth.uid()`, NOT
// auth.role(). Setting test.role would test the wrong code path.
//
// Ladder (verbatim from migration 0002):
//   member  → target=member only.
//   cashier → target ∈ {member, cashier}.
//   manager → target ∈ {member, cashier, manager}.
//   owner   → target ∈ {member, cashier, manager, owner}.
//
// (auth.role_at_least('member') is hard-coded TRUE for any input — including
// for un-authenticated callers in production with a JWT — but here the
// helper's lookup `profiles.id = auth.uid()` only fires for non-member
// targets, so 'member' is always TRUE regardless of caller.)
// =============================================================================
describe('AC5 — auth.role_at_least 4×4 matrix', () => {
  type Role = 'member' | 'cashier' | 'manager' | 'owner';
  const ladder: Record<Role, Record<Role, boolean>> = {
    member: { member: true, cashier: false, manager: false, owner: false },
    cashier: { member: true, cashier: true, manager: false, owner: false },
    manager: { member: true, cashier: true, manager: true, owner: false },
    owner: { member: true, cashier: true, manager: true, owner: true },
  };
  const targets: Role[] = ['member', 'cashier', 'manager', 'owner'];

  for (const callerRole of ['member', 'cashier', 'manager', 'owner'] as Role[]) {
    for (const target of targets) {
      const expected = ladder[callerRole][target];
      it(`caller=${callerRole} target=${target} → ${expected}`, async () => {
        const callerId =
          callerRole === 'member'
            ? memberA
            : callerRole === 'cashier'
              ? cashier
              : callerRole === 'manager'
                ? manager
                : owner;
        await setTestUid(pg, callerId);
        const r = await pg.query<{ ok: boolean }>('SELECT auth.role_at_least($1) AS ok', [target]);
        expect(r.rows[0]!.ok).toBe(expected);
      });
    }
  }

  it('unknown target returns FALSE (defense in depth)', async () => {
    await setTestUid(pg, owner);
    const r = await pg.query<{ ok: boolean }>('SELECT auth.role_at_least($1) AS ok', [
      'superadmin',
    ]);
    expect(r.rows[0]!.ok).toBe(false);
  });
});

// =============================================================================
// AC8 sub-case 7 — anon SELECT returns zero rows (RLS filters silently).
// =============================================================================
describe('AC8.7 — anon SELECT', () => {
  it('anon (test.uid cleared) sees zero rows from profiles', async () => {
    await resetAuthStub(pg);
    // Sanity — bypass predicate holds (auth.uid() IS NULL).
    const probe = await pg.query<{ is_null: boolean }>('SELECT auth.uid() IS NULL AS is_null');
    expect(probe.rows[0]!.is_null).toBe(true);

    // SELECT under anon. profiles_select_self_or_staff requires
    // (id = auth.uid()) — NULL never equals any uuid — OR cashier+, which
    // requires a profiles row for the caller. Neither holds: zero rows.
    const r = await pg.query<{ id: string }>('SELECT id FROM profiles');
    expect(r.rows).toHaveLength(0);
  });
});

// =============================================================================
// AC8 sub-case 8 — anon UPDATE / DELETE deny (zero rows affected).
// Pair with service-role read showing the rows are unchanged.
// =============================================================================
describe('AC8.8 — anon write', () => {
  it('anon UPDATE affects zero rows', async () => {
    await withRollback(pg, async () => {
      // Snapshot member-A BEFORE under service-role (RLS bypassed).
      await asServiceRole(pg);
      const before = await pg.query<{ full_name: string }>(
        'SELECT full_name FROM profiles WHERE id = $1',
        [memberA],
      );
      expect(before.rows).toHaveLength(1);

      // Switch to anon: NOBYPASSRLS role + cleared auth.uid().
      await asAuthenticated(pg);
      // resetAuthStub already clears uid in beforeEach; asServiceRole then
      // flipped role to superuser; asAuthenticated puts us back into
      // app_authenticated and uid is still NULL → this is the anon path.
      const upd = (await pg.query(`UPDATE profiles SET full_name = 'anon-pwned' WHERE id = $1`, [
        memberA,
      ])) as Results;
      // anon (auth.uid() IS NULL) is the bypass path for the protection
      // trigger, AND the UPDATE policy `id = auth.uid() OR
      // auth.role_at_least('manager')` evaluates the first disjunct as
      // (id = NULL) → unknown → false; the role_at_least call also returns
      // false (no profile row matches auth.uid() = NULL). So RLS filters
      // out all rows: rowCount = 0. The role-trigger bypass path is
      // separate from the row-policy gate; an anon UPDATE only sneaks
      // through the trigger if it ALSO sneaks through the row policy.
      expect(upd.affectedRows ?? 0).toBe(0);

      // Confirm row unchanged — service-role read so we see the true state.
      await asServiceRole(pg);
      const after = await pg.query<{ full_name: string }>(
        'SELECT full_name FROM profiles WHERE id = $1',
        [memberA],
      );
      expect(after.rows[0]!.full_name).toBe(before.rows[0]!.full_name);
    });
  });

  it('anon DELETE affects zero rows', async () => {
    await withRollback(pg, async () => {
      // beforeEach already left us as app_authenticated with uid cleared
      // (the anon path). Issue the DELETE directly — RLS denies it.
      const del = (await pg.query('DELETE FROM profiles WHERE id = $1', [memberA])) as Results;
      // delete policy is profiles_delete_manager — anon is not manager+,
      // so RLS filters: rowCount = 0.
      expect(del.affectedRows ?? 0).toBe(0);

      // Sanity — still there. service-role read so we see the true state.
      await asServiceRole(pg);
      const after = await pg.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM profiles WHERE id = $1',
        [memberA],
      );
      expect(after.rows[0]!.n).toBe(1);
    });
  });
});

// =============================================================================
// AC8 sub-case 9 — anon-INSERT denies with SQLSTATE 42501.
// No INSERT policy on profiles → RLS denies INSERT outright (per Postgres
// RLS semantics: missing policy for the command is "deny").
// Premortem R10: pin to error.code, never message; also assert post-state
// (no row inserted) regardless of SQLSTATE drift.
// =============================================================================
describe('AC8.9 — anon INSERT denial', () => {
  it('anon INSERT into profiles raises SQLSTATE 42501', async () => {
    expect.assertions(2); // 1× rejection assertion + 1× post-state count

    // We need a fresh email so we can verify post-state independently of
    // any prior seed (premortem R15).
    const freshEmail = `anon-insert-${crypto.randomUUID()}@rls-test.local`;
    const freshId = crypto.randomUUID();

    // Insert into auth.users first (to satisfy FK) — this is service-role,
    // not anon, so the auth.users insert succeeds (BYPASSRLS + GUC clear).
    await asServiceRole(pg);
    await pg.query('INSERT INTO auth.users (id) VALUES ($1)', [freshId]);

    // Now switch to an authenticated-but-not-the-target identity. The
    // anon path here is "any authenticated caller other than the row's
    // owner" — RLS still has no INSERT policy, so any caller's INSERT is
    // denied. Pick member-A so we exercise an "ordinary user" path.
    //
    // Edge case considered: setting test.uid = freshId would put us in
    // the "owner-of-the-row" path, but RLS denial-by-default still wins
    // (no insert policy → no caller may insert). Test as member-A for
    // explicitness.
    await asAuthenticated(pg);
    await setTestUid(pg, memberA);

    await expect(
      pg.query(
        `INSERT INTO profiles (id, full_name, dob, email, role)
         VALUES ($1, $2, $3, $4, $5)`,
        [freshId, 'Anon Should Not Insert', '1990-01-01', freshEmail, 'member'],
      ),
    ).rejects.toMatchObject({ code: '42501' });

    // Independently — assert the row was NOT inserted, regardless of
    // SQLSTATE. Catches the "RLS lets insert proceed silently" failure
    // mode if pglite ever diverges from production semantics. service-role
    // read so RLS-filtering can't mask a row that DID get inserted.
    await asServiceRole(pg);
    const post = await pg.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM profiles WHERE email = $1',
      [freshEmail],
    );
    expect(post.rows[0]!.n).toBe(0);
  });

  it('truly-anon (test.uid cleared) INSERT also denies', async () => {
    expect.assertions(2);

    const freshEmail = `truly-anon-${crypto.randomUUID()}@rls-test.local`;
    const freshId = crypto.randomUUID();

    // auth.users seed — service-role bypasses RLS for auth.users (no
    // RLS enabled there).
    await asServiceRole(pg);
    await pg.query('INSERT INTO auth.users (id) VALUES ($1)', [freshId]);

    // Switch back to app_authenticated; resetAuthStub already cleared
    // test.uid → auth.uid() returns NULL. This is the anon-via-NOBYPASSRLS
    // path. There's no INSERT policy on profiles, so RLS denies regardless.
    //
    // (If a future migration ever adds `WITH (security_invoker = off)` or
    // similar that lets NULL-uid inserts through, this test catches it.)
    await asAuthenticated(pg);
    await expect(
      pg.query(
        `INSERT INTO profiles (id, full_name, dob, email, role)
         VALUES ($1, $2, $3, $4, $5)`,
        [freshId, 'Truly Anon Should Not Insert', '1990-01-01', freshEmail, 'member'],
      ),
    ).rejects.toMatchObject({ code: '42501' });

    // service-role read so RLS-filtering can't mask a sneaky insert.
    await asServiceRole(pg);
    const post = await pg.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM profiles WHERE email = $1',
      [freshEmail],
    );
    expect(post.rows[0]!.n).toBe(0);
  });
});

// =============================================================================
// AC8 sub-case 10 — privilege-escalation: member-A self-update of role.
// Three variants (premortem R13): simple, multi-column, no-op.
// All three must be rejected with SQLSTATE 42501 by the
// profiles_protect_role_change trigger.
// =============================================================================
describe('AC8.10 — privilege escalation: member-A self-update role', () => {
  it('variant A — simple SET role rejects with 42501', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      await expect(
        pg.query(`UPDATE profiles SET role = 'manager' WHERE id = $1`, [memberA]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('variant B — multi-column SET (role + full_name) rejects with 42501', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      await expect(
        pg.query(
          `UPDATE profiles SET role = 'manager', full_name = 'Pwn'
            WHERE id = $1`,
          [memberA],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('variant C — no-op SET role = role still trips the trigger (column-mention semantics)', async () => {
    // BEFORE UPDATE OF role fires on column-mention, NOT value-change.
    // The trigger function does not short-circuit on NEW.role = OLD.role,
    // so even a no-op rewrite is rejected. If this variant unexpectedly
    // succeeds, the trigger has acquired a value-equality short-circuit
    // that the spec did not require — flag it as a fidelity finding.
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      await expect(
        pg.query(`UPDATE profiles SET role = role WHERE id = $1`, [memberA]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('post-state — member-A role is still "member" (proves rejection rolled back)', async () => {
    // After all three variant attempts above (each in its own rollback),
    // member-A's role must still be 'member'. This is a defense-in-depth
    // check that the trigger raises BEFORE the row update commits, not
    // AFTER — i.e., the change is atomic with the rejection.
    await asServiceRole(pg);
    const r = await pg.query<{ role: string }>(
      'SELECT role::text AS role FROM profiles WHERE id = $1',
      [memberA],
    );
    expect(r.rows[0]!.role).toBe('member');
  });
});

// =============================================================================
// AC8 sub-case 11 — trigger-firing-order invariant.
// Two assertions:
//   (a) Behavioral: a rolled-back unauthorized role change leaves
//       updated_at unadvanced.
//   (b) Introspection (premortem R6): pg_trigger ordered by tgname shows
//       profiles_protect_role_change before set_updated_at. Catches a
//       future rename that inverts the alphabetical ordering — which the
//       behavioral test alone cannot detect (txn rollback masks ordering).
// =============================================================================
describe('AC8.11 — trigger firing order invariant', () => {
  it('behavioral: updated_at NOT advanced after a rejected role change', async () => {
    expect.assertions(3);
    await withRollback(pg, async () => {
      // Snapshot updated_at BEFORE under service-role.
      await asServiceRole(pg);
      const before = await pg.query<{ updated_at: string }>(
        'SELECT updated_at FROM profiles WHERE id = $1',
        [memberA],
      );
      expect(before.rows).toHaveLength(1);

      // Attempt the unauthorized role change inside a savepoint so we can
      // recover from the post-rejection aborted-txn state — Postgres marks
      // the surrounding txn as aborted on any error, but ROLLBACK TO
      // SAVEPOINT restores it without unwinding the outer withRollback.
      await asAuthenticated(pg);
      await setTestUid(pg, memberA);
      await pg.query('SAVEPOINT before_rejected_update');
      await expect(
        pg.query(`UPDATE profiles SET role = 'manager' WHERE id = $1`, [memberA]),
      ).rejects.toMatchObject({ code: '42501' });
      await pg.query('ROLLBACK TO SAVEPOINT before_rejected_update');

      // updated_at must equal its prior value — the txn aborted before
      // set_updated_at could persist its bump.
      await asServiceRole(pg);
      const after = await pg.query<{ updated_at: string }>(
        'SELECT updated_at FROM profiles WHERE id = $1',
        [memberA],
      );
      expect(after.rows[0]!.updated_at).toEqual(before.rows[0]!.updated_at);
    });
  });

  it('introspection: profiles_protect_role_change sorts before set_updated_at in pg_trigger', async () => {
    // pg_trigger lists every trigger; we filter to non-internal triggers on
    // public.profiles. Ordering by tgname ASC matches Postgres' rule for
    // multi-trigger firing on the same event.
    const r = await pg.query<{ tgname: string }>(`
      SELECT tgname FROM pg_trigger
       WHERE tgrelid = 'public.profiles'::regclass
         AND NOT tgisinternal
       ORDER BY tgname ASC
    `);
    const names = r.rows.map((row) => row.tgname);
    const protectIdx = names.indexOf('profiles_protect_role_change');
    const updatedIdx = names.indexOf('set_updated_at');
    expect(protectIdx).toBeGreaterThanOrEqual(0);
    expect(updatedIdx).toBeGreaterThanOrEqual(0);
    expect(protectIdx).toBeLessThan(updatedIdx);
  });
});

// =============================================================================
// AC8 sub-case 12 — service-role bypass.
// With test.uid cleared (auth.uid() IS NULL), an UPDATE that changes role
// succeeds. Pair with the negative-path own-uid test above (variant A).
// Pattern (premortem R7): assert the post-state explicitly — role actually
// became the new value. Don't trust affectedRows alone.
// =============================================================================
describe('AC8.12 — service-role bypass', () => {
  it('cleared test.uid permits role change (auth.uid() IS NULL bypass)', async () => {
    await withRollback(pg, async () => {
      // Service-role bypass in production is two-axis:
      //   (a) RLS row-policies are bypassed because `service_role` has
      //       BYPASSRLS at the Postgres-role level.
      //   (b) The protection trigger's bypass predicate `auth.uid() IS NULL`
      //       fires because Supabase doesn't set a JWT-uid on service-role
      //       requests.
      // Simulate (a) via RESET ROLE (back to the superuser, which has
      // BYPASSRLS); simulate (b) via resetAuthStub (clears test.uid).
      // beforeEach will SET ROLE app_authenticated again before the next test.
      await pg.query('RESET ROLE');
      await resetAuthStub(pg);

      // Sanity: bypass predicate holds.
      const probe = await pg.query<{ is_null: boolean }>('SELECT auth.uid() IS NULL AS is_null');
      expect(probe.rows[0]!.is_null).toBe(true);

      const upd = (await pg.query(`UPDATE profiles SET role = 'manager' WHERE id = $1`, [
        memberA,
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);

      // Post-state: role is actually 'manager' now (premortem R7).
      const after = await pg.query<{ role: string }>(
        'SELECT role::text AS role FROM profiles WHERE id = $1',
        [memberA],
      );
      expect(after.rows[0]!.role).toBe('manager');
    });
  });

  it('non-bypass equivalent: same UPDATE under member-A own uid rejects with 42501 (paired negative)', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      await expect(
        pg.query(`UPDATE profiles SET role = 'manager' WHERE id = $1`, [memberA]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('setTestRole is NOT a bypass — only setTestUid(null) is', async () => {
    // Defense against a future drift where setTestRole('service_role')
    // accidentally becomes load-bearing. The migration's bypass predicate
    // is `auth.uid() IS NULL`, NOT `auth.role() = 'service_role'`. Setting
    // test.role does NOT clear test.uid, so the trigger still rejects.
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      await setTestRole(pg, 'service_role');
      await expect(
        pg.query(`UPDATE profiles SET role = 'manager' WHERE id = $1`, [memberA]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

// =============================================================================
// WITH CHECK behavioral coverage (premortem R16 — backstop for the t5
// shape test's structural absence check). The UPDATE policy
// profiles_update_self_or_manager has a WITH CHECK clause matching its
// USING clause. Behavioral test: as member-A, attempt to UPDATE member-A's
// row to set id = <some-other-uuid>. The pre-image (id = memberA) passes
// USING. The post-image (id = otherId) violates WITH CHECK because
// member-A no longer owns the row and is not manager+. Postgres reports
// this as RLS row violation: SQLSTATE 42501.
//
// Note: this attempt also runs into the FK constraint (id must reference
// auth.users(id)). We seed a fresh auth.users row first so the FK does
// not preempt the WITH CHECK rejection, allowing this test to be
// load-bearing on the WITH CHECK clause specifically.
// =============================================================================
describe('+ WITH CHECK behavioral coverage', () => {
  it('member-A cannot rewrite their own id to a different uuid (WITH CHECK rejects)', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      // Seed a fresh auth.users row (so FK doesn't trip first).
      await resetAuthStub(pg);
      const freshUid = crypto.randomUUID();
      await pg.query('INSERT INTO auth.users (id) VALUES ($1)', [freshUid]);

      await setTestUid(pg, memberA);
      // The post-image id = freshUid would satisfy the FK but breaks the
      // WITH CHECK (id = auth.uid() OR auth.role_at_least('manager')).
      // member-A's auth.uid() = memberA, not freshUid; member-A is not
      // manager+; so WITH CHECK fails → 42501.
      await expect(
        pg.query(`UPDATE profiles SET id = $1 WHERE id = $2`, [freshUid, memberA]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
