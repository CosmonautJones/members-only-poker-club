/**
 * RLS unit tests for `feature_flags` (ADR-0035 Slice 4, spec AC2 + AC3).
 *
 * Run locally:    pnpm test tests/db/rls-feature-flags.test.ts
 * Prerequisites:  none — pglite is in-process WASM Postgres.
 * No Docker. No Supabase CLI. No network.
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC2.
 * Migrations under test:
 *   - supabase/migrations/0001_feature_flags.sql       (cycle 1 schema)
 *   - supabase/migrations/0002_profiles_and_roles.sql  (cycle 1 role ladder)
 *   - supabase/migrations/0006_feature_flags_rls.sql   (the ADR-0035 RLS posture)
 *
 * Substrate: @electric-sql/pglite — real Postgres (RLS, policies, SQLSTATE
 * codes all behave as in production).
 *
 * Auth stub: tests/db/_fixtures/auth-stub.ts. Bypass predicate is
 * `auth.uid() IS NULL` (cleared via resetAuthStub).
 *
 * Sub-case map (AC2):
 *   1. member SELECT  — returns all rows (authenticated read is universal).
 *   2. cashier SELECT — returns all rows.
 *   3. manager SELECT — returns all rows.
 *   4. member writes are denied:
 *        - UPDATE/DELETE: rowCount = 0 (RLS silent-filters the row because
 *          the FOR ALL write policy's USING(auth.role_at_least('manager'))
 *          is FALSE; the SELECT policy is FOR SELECT only and does not
 *          apply to UPDATE/DELETE — Postgres' standard behavior).
 *        - INSERT: raises SQLSTATE 42501 (INSERT has no USING gate; the
 *          WITH CHECK predicate is evaluated and rejects → 42501).
 *   5. cashier writes denied with the same shape as member (UPDATE: rowCount
 *      = 0; INSERT: 42501). Cashier is below manager+ on the ladder so the
 *      write policy denies identically to member.
 *   6. manager UPDATE/INSERT/DELETE — succeed with verified post-state.
 *   7. anon (unauthenticated) SELECT — returns zero rows; UPDATE affects 0.
 *   8. service-role context — bypasses RLS (BYPASSRLS posture).
 *   9. structural — RLS is ENABLED and FORCED on feature_flags, both
 *      policies present.
 *
 * Assertion contract: denial assertions match `error.code`, never message
 * text. Tests that use `rejects.toMatchObject` declare `expect.assertions(N)`.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PGlite, type Results } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupAuthStub, setTestUid, resetAuthStub } from './_fixtures/auth-stub';
import { seedProfile } from './_fixtures/profiles';
import {
  setupAppAuthenticatedRole,
  asAuthenticated,
  asServiceRole,
  withRollback,
} from './_fixtures/rls-helpers';

// ESM/CJS-safe path resolution (mirrors rls-profiles.test.ts + audit-log.test.ts).
const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const MIGRATION_0001_PATH = resolve(
  TEST_DIR,
  '..',
  '..',
  'supabase',
  'migrations',
  '0001_feature_flags.sql',
);
const MIGRATION_0002_PATH = resolve(
  TEST_DIR,
  '..',
  '..',
  'supabase',
  'migrations',
  '0002_profiles_and_roles.sql',
);
const MIGRATION_0006_PATH = resolve(
  TEST_DIR,
  '..',
  '..',
  'supabase',
  'migrations',
  '0006_feature_flags_rls.sql',
);

let pg: PGlite;

async function runSqlBlock(sql: string): Promise<void> {
  await (pg as unknown as { exec: (s: string) => Promise<unknown> }).exec(sql);
}

// Module-scope seeded uuids — populated in beforeAll, reused across describes.
let memberA = '';
let cashier = '';
let manager = '';
let owner = '';

beforeAll(async () => {
  pg = new PGlite();

  // 1. Auth-stub FIRST — creates schema `auth`, plus auth.uid() / auth.role()
  //    bound to the test.uid / test.role GUCs. Migration 0002 depends on
  //    auth.users(id) existing as an FK target.
  await setupAuthStub(pg);

  // 2. Stub auth.users — production Supabase ships this; pglite does not.
  await runSqlBlock(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `);

  // 3. Apply the three migrations in cycle order. 0001 creates feature_flags
  //    (no RLS); 0002 brings profiles + role ladder + auth.role_at_least;
  //    0006 enables RLS on feature_flags and ships the two policies.
  const migration0001 = readFileSync(MIGRATION_0001_PATH, 'utf8');
  await runSqlBlock(migration0001);
  const migration0002 = readFileSync(MIGRATION_0002_PATH, 'utf8');
  await runSqlBlock(migration0002);
  const migration0006 = readFileSync(MIGRATION_0006_PATH, 'utf8');
  await runSqlBlock(migration0006);

  // 4. Seed profile fixtures. Each needs a real auth.users row first (FK
  //    constraint), then a matching profile. Seeding runs as superuser
  //    (BYPASSRLS) so it succeeds even though profiles has RLS enabled with
  //    no INSERT policy.
  const seedAs = async (
    role: 'member' | 'cashier' | 'manager' | 'owner',
    label: string,
  ): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@flags-test.local`,
    });
    return profile.id;
  };
  memberA = await seedAs('member', 'member-a');
  cashier = await seedAs('cashier', 'cashier');
  manager = await seedAs('manager', 'manager');
  owner = await seedAs('owner', 'owner');

  // 5. Seed two feature_flags rows under service-role (RLS-bypassed for the
  //    superuser). These are the rows every per-test SELECT case asserts on.
  await pg.query(
    `INSERT INTO feature_flags (key, enabled, percent, owner)
     VALUES ('signup-experiment-2026', false, 0, 'owner@club.test')`,
  );
  await pg.query(
    `INSERT INTO feature_flags (key, enabled, percent, owner)
     VALUES ('kill-payments', false, 0, 'owner@club.test')`,
  );

  // 6. Create app_authenticated (NOBYPASSRLS NOINHERIT) with grants for
  //    profiles + feature_flags + the auth.role_at_least helper. Mirrors the
  //    Supabase `authenticated` role in production (no BYPASSRLS).
  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'feature_flags'],
  });
});

afterAll(async () => {
  await pg?.close?.();
});

beforeEach(async () => {
  // Clear identity GUCs so no test inherits identity from a prior one.
  await resetAuthStub(pg);
  // Default per-test role: app_authenticated (NOBYPASSRLS) — RLS evaluates.
  // Sub-cases that simulate service-role explicitly call asServiceRole.
  await pg.query('SET ROLE app_authenticated');
});

// =============================================================================
// Structural smoke — RLS is enabled AND forced on feature_flags. Catches a
// future migration that disables either flag.
// =============================================================================
describe('structural — RLS posture on feature_flags', () => {
  it('relrowsecurity = true AND relforcerowsecurity = true', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class
        WHERE oid = 'public.feature_flags'::regclass`,
    );
    expect(r.rows[0]?.relrowsecurity).toBe(true);
    expect(r.rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('exactly two policies exist on feature_flags with the expected names', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polname: string }>(
      `SELECT polname FROM pg_policy
        WHERE polrelid = 'public.feature_flags'::regclass
        ORDER BY polname ASC`,
    );
    expect(r.rows.map((row) => row.polname)).toEqual([
      'feature_flags_select_authenticated',
      'feature_flags_write_manager',
    ]);
  });

  it('seeded rows exist under service-role (sanity)', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM feature_flags');
    expect(r.rows[0]!.n).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// AC2.1 — member SELECT returns rows.
// The select policy is `USING (auth.uid() IS NOT NULL)` — every authenticated
// caller sees every row. The runtime depends on this so feature gates resolve
// for member-viewing surfaces.
// =============================================================================
describe('AC2.1 — member SELECT', () => {
  it('member-roled session CAN SELECT feature_flags rows', async () => {
    await setTestUid(pg, memberA);
    const r = await pg.query<{ key: string }>('SELECT key FROM feature_flags ORDER BY key');
    expect(r.rows.map((row) => row.key)).toEqual(['kill-payments', 'signup-experiment-2026']);
  });
});

// =============================================================================
// AC2.2 — cashier SELECT returns rows. Cashier is not manager+, but SELECT
// is authentication-only; cashier still sees every row. Their UPDATE is
// denied in AC2.5 below.
// =============================================================================
describe('AC2.2 — cashier SELECT', () => {
  it('cashier-roled session CAN SELECT feature_flags rows', async () => {
    await setTestUid(pg, cashier);
    const r = await pg.query<{ key: string }>('SELECT key FROM feature_flags ORDER BY key');
    expect(r.rows.map((row) => row.key)).toEqual(['kill-payments', 'signup-experiment-2026']);
  });
});

// =============================================================================
// AC2.3 — manager / owner SELECT returns rows. Confirms the write policy
// doesn't inadvertently shadow the select policy for manager+ — Postgres
// ORs USING clauses across policies on the same command.
// =============================================================================
describe('AC2.3 — manager SELECT', () => {
  it('manager-roled session CAN SELECT feature_flags rows', async () => {
    await setTestUid(pg, manager);
    const r = await pg.query<{ key: string }>('SELECT key FROM feature_flags ORDER BY key');
    expect(r.rows.map((row) => row.key)).toEqual(['kill-payments', 'signup-experiment-2026']);
  });

  it('owner-roled session CAN SELECT feature_flags rows', async () => {
    await setTestUid(pg, owner);
    const r = await pg.query<{ key: string }>('SELECT key FROM feature_flags ORDER BY key');
    expect(r.rows.map((row) => row.key)).toEqual(['kill-payments', 'signup-experiment-2026']);
  });
});

// =============================================================================
// AC2.4 — member writes are denied.
//
// Postgres RLS behavior under the prescribed two-policy shape:
//   - The SELECT policy is `FOR SELECT` only and does NOT apply to UPDATE /
//     DELETE / INSERT. Only the `feature_flags_write_manager` policy
//     (FOR ALL) applies to those commands.
//   - For UPDATE / DELETE: USING is evaluated as a row filter. When the
//     predicate (`auth.role_at_least('manager')`) is FALSE, RLS filters the
//     row silently → rowCount = 0. NOT SQLSTATE 42501. This mirrors cycle
//     1's profile UPDATE/DELETE-denial pattern (rls-profiles.test.ts
//     AC8.2 / AC8.3).
//   - For INSERT: there is no USING gate (the row didn't pre-exist); WITH
//     CHECK on the FOR ALL policy evaluates against the NEW row and
//     `auth.role_at_least('manager')` returns FALSE → raises SQLSTATE 42501.
// =============================================================================
describe('AC2.4 — member writes denied', () => {
  it('member-roled session UPDATE feature_flags affects zero rows (RLS silent filter)', async () => {
    await withRollback(pg, async () => {
      // Snapshot under service-role.
      await asServiceRole(pg);
      const before = await pg.query<{ enabled: boolean }>(
        'SELECT enabled FROM feature_flags WHERE key = $1',
        ['kill-payments'],
      );
      expect(before.rows[0]?.enabled).toBe(false);

      // Attempt UPDATE under member — write policy USING is FALSE for
      // member, so RLS filters the row out → rowCount = 0, no exception.
      await asAuthenticated(pg);
      await setTestUid(pg, memberA);
      const upd = (await pg.query(`UPDATE feature_flags SET enabled = true WHERE key = $1`, [
        'kill-payments',
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);

      // Verify the row is unchanged under service-role read (rowCount = 0
      // alone is ambiguous; cross-check the actual value).
      await asServiceRole(pg);
      const after = await pg.query<{ enabled: boolean }>(
        'SELECT enabled FROM feature_flags WHERE key = $1',
        ['kill-payments'],
      );
      expect(after.rows[0]?.enabled).toBe(false);
    });
  });

  it('member-roled session INSERT into feature_flags raises SQLSTATE 42501', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      // INSERT has no USING row-filter — WITH CHECK on the new row is the
      // gate. auth.role_at_least('manager') = FALSE for member → 42501.
      await expect(
        pg.query(
          `INSERT INTO feature_flags (key, enabled, percent, owner)
             VALUES ($1, $2, $3, $4)`,
          ['member-tried-insert', false, 0, 'member@club.test'],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('member-roled session DELETE from feature_flags affects zero rows (RLS silent filter)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      // Same as UPDATE: USING is FALSE → row filtered → rowCount = 0.
      const del = (await pg.query(`DELETE FROM feature_flags WHERE key = $1`, [
        'kill-payments',
      ])) as Results;
      expect(del.affectedRows ?? 0).toBe(0);

      // Row still present under service-role read.
      await asServiceRole(pg);
      const after = await pg.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM feature_flags WHERE key = $1',
        ['kill-payments'],
      );
      expect(after.rows[0]!.n).toBe(1);
    });
  });
});

// =============================================================================
// AC2.5 — cashier writes are denied with the same shape as member.
// Cashier sits below manager+ on the ladder; the write policy denies
// identically to member (UPDATE: rowCount = 0; INSERT: 42501). Cashier read
// still works (AC2.2) so any in-app gate controlling cashier-only features
// still evaluates.
// =============================================================================
describe('AC2.5 — cashier writes denied', () => {
  it('cashier-roled session UPDATE feature_flags affects zero rows', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, cashier);
      const upd = (await pg.query(`UPDATE feature_flags SET enabled = true WHERE key = $1`, [
        'kill-payments',
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);

      // Service-role read confirms unchanged.
      await asServiceRole(pg);
      const after = await pg.query<{ enabled: boolean }>(
        'SELECT enabled FROM feature_flags WHERE key = $1',
        ['kill-payments'],
      );
      expect(after.rows[0]?.enabled).toBe(false);
    });
  });

  it('cashier-roled session INSERT into feature_flags raises SQLSTATE 42501', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, cashier);
      await expect(
        pg.query(
          `INSERT INTO feature_flags (key, enabled, percent, owner)
             VALUES ($1, $2, $3, $4)`,
          ['cashier-tried-insert', false, 0, 'cashier@club.test'],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

// =============================================================================
// AC2.6 — manager+ writes succeed. Positive privilege case for the write
// policy. Assert post-state explicitly so we know the row actually changed
// (not just that rowCount > 0).
// =============================================================================
describe('AC2.6 — manager+ writes succeed', () => {
  it('manager-roled session CAN UPDATE feature_flags (post-state verified)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      const upd = (await pg.query(`UPDATE feature_flags SET enabled = true WHERE key = $1`, [
        'kill-payments',
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);

      const after = await pg.query<{ enabled: boolean }>(
        'SELECT enabled FROM feature_flags WHERE key = $1',
        ['kill-payments'],
      );
      expect(after.rows[0]?.enabled).toBe(true);
    });
  });

  it('owner-roled session CAN UPDATE feature_flags', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, owner);
      const upd = (await pg.query(`UPDATE feature_flags SET percent = 25 WHERE key = $1`, [
        'signup-experiment-2026',
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);

      const after = await pg.query<{ percent: number }>(
        'SELECT percent FROM feature_flags WHERE key = $1',
        ['signup-experiment-2026'],
      );
      expect(after.rows[0]?.percent).toBe(25);
    });
  });

  it('manager-roled session CAN INSERT a new flag', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      const ins = (await pg.query(
        `INSERT INTO feature_flags (key, enabled, percent, owner)
           VALUES ($1, $2, $3, $4)`,
        ['new-experiment', false, 0, 'manager@club.test'],
      )) as Results;
      expect(ins.affectedRows ?? 0).toBe(1);

      const after = await pg.query<{ key: string }>(
        'SELECT key FROM feature_flags WHERE key = $1',
        ['new-experiment'],
      );
      expect(after.rows[0]?.key).toBe('new-experiment');
    });
  });

  it('manager-roled session CAN DELETE a flag', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      const del = (await pg.query(`DELETE FROM feature_flags WHERE key = $1`, [
        'kill-payments',
      ])) as Results;
      expect(del.affectedRows ?? 0).toBe(1);

      await asServiceRole(pg);
      const after = await pg.query<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM feature_flags WHERE key = $1',
        ['kill-payments'],
      );
      expect(after.rows[0]!.n).toBe(0);
    });
  });
});

// =============================================================================
// AC2.7 — anon (auth.uid() IS NULL) SELECT returns zero rows.
// The select policy is `USING (auth.uid() IS NOT NULL)`. When test.uid is
// cleared the predicate is FALSE → RLS filters every row silently. This is
// the "logged-out" path under the app_authenticated (NOBYPASSRLS) role.
// =============================================================================
describe('AC2.7 — anon SELECT filtered', () => {
  it('anon (test.uid cleared) sees zero rows from feature_flags', async () => {
    // beforeEach already cleared test.uid and set role to app_authenticated.
    const probe = await pg.query<{ is_null: boolean }>('SELECT auth.uid() IS NULL AS is_null');
    expect(probe.rows[0]!.is_null).toBe(true);

    const r = await pg.query<{ key: string }>('SELECT key FROM feature_flags');
    expect(r.rows).toHaveLength(0);
  });

  it('anon UPDATE on feature_flags affects zero rows (RLS filters silently)', async () => {
    await withRollback(pg, async () => {
      // beforeEach already left us as app_authenticated with uid cleared
      // (the anon path). RLS filters the row before WITH CHECK evaluates,
      // so the UPDATE reports rowCount = 0 rather than 42501.
      const upd = (await pg.query(`UPDATE feature_flags SET enabled = true WHERE key = $1`, [
        'kill-payments',
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);

      // Service-role read confirms unchanged.
      await asServiceRole(pg);
      const after = await pg.query<{ enabled: boolean }>(
        'SELECT enabled FROM feature_flags WHERE key = $1',
        ['kill-payments'],
      );
      expect(after.rows[0]?.enabled).toBe(false);
    });
  });
});

// =============================================================================
// AC2.8 — service-role bypass.
// With RESET ROLE (back to the BYPASSRLS superuser) AND test.uid cleared,
// SELECT returns every row regardless of policy. This is the production
// service-role path (Supabase service-role has BYPASSRLS at the Postgres-role
// level). Sanity check that the policy is correctly scoped — a service-role
// emergency repair should always see and write every row.
// =============================================================================
describe('AC2.8 — service-role bypass', () => {
  it('cleared test.uid + RESET ROLE permits SELECT of all rows', async () => {
    await asServiceRole(pg);
    const probe = await pg.query<{ is_null: boolean }>('SELECT auth.uid() IS NULL AS is_null');
    expect(probe.rows[0]!.is_null).toBe(true);

    const r = await pg.query<{ key: string }>('SELECT key FROM feature_flags ORDER BY key');
    expect(r.rows.map((row) => row.key)).toEqual(['kill-payments', 'signup-experiment-2026']);
  });

  it('cleared test.uid + RESET ROLE permits UPDATE (BYPASSRLS at role level)', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      const upd = (await pg.query(`UPDATE feature_flags SET enabled = true WHERE key = $1`, [
        'kill-payments',
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);

      const after = await pg.query<{ enabled: boolean }>(
        'SELECT enabled FROM feature_flags WHERE key = $1',
        ['kill-payments'],
      );
      expect(after.rows[0]?.enabled).toBe(true);
    });
  });
});
