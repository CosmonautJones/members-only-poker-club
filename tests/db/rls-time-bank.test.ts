/**
 * RLS unit tests for `time_wallets` + `time_ledger` (ADR-0036 Slice 1, AC13).
 *
 * Run locally:    pnpm test tests/db/rls-time-bank.test.ts
 * Prerequisites:  none — pglite is in-process WASM Postgres.
 *
 * Spec: docs/specs/0036-payment-management-console-implementation.md AC13.
 * Migrations under test: 0001..0016 (full slice-1 schema).
 *
 * This file covers BOTH tables because they share a SELECT policy posture and
 * the AC5 trigger (0012) crosses them. The three policies pinned by AC13:
 *   1. time_wallets_self_or_cashier_read — SELECT on time_wallets.
 *   2. time_ledger_self_or_cashier_read  — SELECT on time_ledger.
 *   3. time_ledger_cashier_insert        — INSERT on time_ledger
 *      WITH CHECK auth.role_at_least('cashier'). PER-MEMBER AUTHORITY IS
 *      INTENTIONALLY NOT GATED HERE (premortem R6) — the matrix lives in
 *      lib/payments/authority.ts.
 * NO INSERT policy on time_wallets (rows written exclusively by the AC5
 * trigger SECURITY DEFINER function in 0012). NO UPDATE / DELETE policy on
 * either table (time_ledger is append-only per ADR-0011; time_wallets is
 * maintained by the trigger).
 *
 * Sub-case map (per dispatch 0017 + synthesis D5 + D6 + premortem R6):
 *   1. structural — both tables RLS+FORCE; policies named correctly.
 *   2. time_wallets SELECT: self/cashier+/anon.
 *   3. time_ledger SELECT: self/cashier+/anon.
 *   4. time_ledger INSERT: cashier+ allowed (named sub-case documenting that
 *      cashier-insert-for-other-member IS allowed at the RLS layer — see R6);
 *      member denied (42501).
 *   5. AC5 trigger fires: cashier INSERT → time_wallets.balance_minutes
 *      updates via the trigger.
 *   6. service-role: INSERT into time_ledger succeeds + trigger fires (D6).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PGlite, type Results } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupAuthStub, setTestUid, resetAuthStub } from './_fixtures/auth-stub';
import { seedProfile } from './_fixtures/profiles';
import { setupAppAuthenticatedRole, asServiceRole, withRollback } from './_fixtures/rls-helpers';

const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const MIGRATIONS_DIR = resolve(TEST_DIR, '..', '..', 'supabase', 'migrations');

const MIGRATIONS = [
  '0001_feature_flags.sql',
  '0002_profiles_and_roles.sql',
  '0003_audit_log.sql',
  '0004_privacy_soft_delete.sql',
  '0005_privacy_requests.sql',
  '0006_feature_flags_rls.sql',
  '0007_clubs_and_display_tz.sql',
  '0008_payments.sql',
  '0009_memberships.sql',
  '0010_time_wallets.sql',
  '0011_time_ledger.sql',
  '0012_time_ledger_balance_trigger.sql',
  '0013_disputes.sql',
  '0014_stripe_webhook_events.sql',
  '0015_refund_requests.sql',
  '0016_payments_rls.sql',
];

let pg: PGlite;

async function runSqlBlock(sql: string): Promise<void> {
  const runner = (pg as unknown as { exec: (s: string) => Promise<unknown> })['exec'];
  await runner.call(pg, sql);
}

let memberA = '';
let memberB = '';
let cashier = '';
let manager = '';
let owner = '';

// Unique idempotency-key counter — time_ledger has a bare UNIQUE on
// idempotency_key, so every INSERT in this file (across all sub-cases) must
// use a distinct value to avoid 23505 collisions on retried tests.
let idemSeq = 0;
function nextIdem(label: string): string {
  idemSeq += 1;
  return `idem_${label}_${idemSeq}`;
}

beforeAll(async () => {
  pg = new PGlite({ extensions: { pgcrypto } });

  await setupAuthStub(pg);

  await runSqlBlock(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `);

  for (const name of MIGRATIONS) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
    await runSqlBlock(sql);
  }

  const seedAs = async (
    role: 'member' | 'cashier' | 'manager' | 'owner',
    label: string,
  ): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@time-bank-rls-test.local`,
    });
    return profile.id;
  };
  memberA = await seedAs('member', 'member-a');
  memberB = await seedAs('member', 'member-b');
  cashier = await seedAs('cashier', 'cashier');
  manager = await seedAs('manager', 'manager');
  owner = await seedAs('owner', 'owner');

  // Seed an initial time_ledger row per member under service-role so the
  // SELECT sub-cases have rows. The trigger fires and creates a corresponding
  // time_wallets row. memberA gets +60, memberB gets +120 (so cross-tenant
  // SELECT denial is unambiguous).
  await pg.query(
    `INSERT INTO time_ledger (profile_id, action, amount_minutes, actor_id, idempotency_key)
       VALUES ($1, 'manual_credit', 60, $2, $3)`,
    [memberA, owner, nextIdem('seed_a')],
  );
  await pg.query(
    `INSERT INTO time_ledger (profile_id, action, amount_minutes, actor_id, idempotency_key)
       VALUES ($1, 'manual_credit', 120, $2, $3)`,
    [memberB, owner, nextIdem('seed_b')],
  );

  // Grant the app_authenticated role access. Includes payments because
  // time_ledger.source_payment_id is an FK target some tests may reference
  // (kept off the surface here — manual_credit rows are payment-less).
  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'time_wallets', 'time_ledger', 'payments'],
    sequences: ['time_ledger_id_seq'],
  });
});

afterAll(async () => {
  await pg?.close?.();
});

beforeEach(async () => {
  await resetAuthStub(pg);
  await pg.query('SET ROLE app_authenticated');
});

// =============================================================================
// Structural — both tables RLS+FORCE; correct policies present.
// =============================================================================
describe('structural — RLS posture on time_wallets + time_ledger', () => {
  it('time_wallets relrowsecurity = true AND relforcerowsecurity = true', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE oid = 'public.time_wallets'::regclass`,
    );
    expect(r.rows[0]?.relrowsecurity).toBe(true);
    expect(r.rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('time_ledger relrowsecurity = true AND relforcerowsecurity = true', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE oid = 'public.time_ledger'::regclass`,
    );
    expect(r.rows[0]?.relrowsecurity).toBe(true);
    expect(r.rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('time_wallets has exactly one policy: time_wallets_self_or_cashier_read', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polname: string }>(
      `SELECT polname FROM pg_policy
        WHERE polrelid = 'public.time_wallets'::regclass
        ORDER BY polname ASC`,
    );
    expect(r.rows.map((row) => row.polname)).toEqual(['time_wallets_self_or_cashier_read']);
  });

  it('time_ledger has exactly two policies (SELECT + cashier INSERT)', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polname: string }>(
      `SELECT polname FROM pg_policy
        WHERE polrelid = 'public.time_ledger'::regclass
        ORDER BY polname ASC`,
    );
    expect(r.rows.map((row) => row.polname)).toEqual([
      'time_ledger_cashier_insert',
      'time_ledger_self_or_cashier_read',
    ]);
  });

  it('time_wallets has no INSERT/UPDATE/DELETE policy (trigger-only writes)', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polcmd: string }>(
      `SELECT polcmd::text FROM pg_policy
        WHERE polrelid = 'public.time_wallets'::regclass`,
    );
    const cmds = r.rows.map((row) => row.polcmd);
    expect(cmds).not.toContain('a');
    expect(cmds).not.toContain('w');
    expect(cmds).not.toContain('d');
  });

  it('time_ledger has no UPDATE/DELETE policy (append-only per ADR-0011)', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polcmd: string }>(
      `SELECT polcmd::text FROM pg_policy
        WHERE polrelid = 'public.time_ledger'::regclass`,
    );
    const cmds = r.rows.map((row) => row.polcmd);
    expect(cmds).not.toContain('w');
    expect(cmds).not.toContain('d');
  });
});

// =============================================================================
// time_wallets SELECT — self OR cashier+.
// =============================================================================
describe('time_wallets SELECT policy — self OR cashier+', () => {
  it('memberA sees ONLY their own wallet row', async () => {
    await setTestUid(pg, memberA);
    const r = await pg.query<{ profile_id: string; balance_minutes: string }>(
      'SELECT profile_id, balance_minutes::text AS balance_minutes FROM time_wallets',
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.profile_id).toBe(memberA);
    expect(r.rows[0]?.balance_minutes).toBe('60');
  });

  it('memberB sees ONLY their own wallet row (cross-tenant denial)', async () => {
    await setTestUid(pg, memberB);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM time_wallets');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.profile_id).toBe(memberB);
  });

  it('cashier sees ALL wallet rows', async () => {
    await setTestUid(pg, cashier);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM time_wallets');
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('manager sees ALL wallet rows', async () => {
    await setTestUid(pg, manager);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM time_wallets');
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('anon (uid cleared) sees zero rows', async () => {
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM time_wallets');
    expect(r.rows).toHaveLength(0);
  });
});

// =============================================================================
// time_ledger SELECT — self OR cashier+.
// =============================================================================
describe('time_ledger SELECT policy — self OR cashier+', () => {
  it('memberA sees ONLY their own ledger rows', async () => {
    await setTestUid(pg, memberA);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM time_ledger');
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
    for (const row of r.rows) {
      expect(row.profile_id).toBe(memberA);
    }
  });

  it('memberB sees ONLY their own ledger rows', async () => {
    await setTestUid(pg, memberB);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM time_ledger');
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
    for (const row of r.rows) {
      expect(row.profile_id).toBe(memberB);
    }
  });

  it('cashier sees ALL ledger rows', async () => {
    await setTestUid(pg, cashier);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM time_ledger');
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('anon (uid cleared) sees zero rows', async () => {
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM time_ledger');
    expect(r.rows).toHaveLength(0);
  });
});

// =============================================================================
// time_ledger INSERT — cashier+ only at the RLS layer (premortem R6).
//
// PER-MEMBER AUTHORITY IS INTENTIONALLY NOT GATED IN RLS. The cashier-insert-
// for-other-member sub-case below documents that this is BY DESIGN — the
// authority matrix lives in lib/payments/authority.ts. DO NOT "fix" this
// test by tightening the WITH CHECK to actor_id = auth.uid() — that would
// break the service-role webhook write path (where actor_id is resolved
// post-validation and may not match the session).
// =============================================================================
describe('time_ledger INSERT policy — cashier+ at RLS layer (authority is app-layer)', () => {
  it('cashier-insert-for-other-member IS allowed at the RLS layer (premortem R6)', async () => {
    // LOAD-BEARING COMMENT — DO NOT "fix" this test by tightening the WITH
    // CHECK. The intentional posture is: RLS gates the role of the inserter
    // ONLY; the authority matrix (who can credit/debit whom, by how much) is
    // enforced by lib/payments/authority.ts in the server action. A tighter
    // RLS policy here would break the Slice 2 service-role webhook write
    // path. See .conductor/36/returns/0005-premortem-rls.md §R6 and the
    // COMMENT ON POLICY block in supabase/migrations/0016_payments_rls.sql.
    await withRollback(pg, async () => {
      await setTestUid(pg, cashier);
      const r = (await pg.query(
        `INSERT INTO time_ledger (profile_id, action, amount_minutes, actor_id, idempotency_key)
           VALUES ($1, 'manual_credit', 30, $2, $3)`,
        [memberA, cashier, nextIdem('cashier_for_member_a')],
      )) as Results;
      expect(r.affectedRows ?? 0).toBe(1);
    });
  });

  it('cashier INSERT for own actions also succeeds (sanity)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, cashier);
      const r = (await pg.query(
        `INSERT INTO time_ledger (profile_id, action, amount_minutes, actor_id, idempotency_key)
           VALUES ($1, 'manual_credit', 15, $2, $3)`,
        [memberB, cashier, nextIdem('cashier_for_member_b')],
      )) as Results;
      expect(r.affectedRows ?? 0).toBe(1);
    });
  });

  it('manager INSERT succeeds (above-cashier threshold)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      const r = (await pg.query(
        `INSERT INTO time_ledger (profile_id, action, amount_minutes, actor_id, idempotency_key)
           VALUES ($1, 'manual_credit', 45, $2, $3)`,
        [memberA, manager, nextIdem('manager_for_member_a')],
      )) as Results;
      expect(r.affectedRows ?? 0).toBe(1);
    });
  });

  it('member INSERT denied with SQLSTATE 42501', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      await expect(
        pg.query(
          `INSERT INTO time_ledger (profile_id, action, amount_minutes, actor_id, idempotency_key)
             VALUES ($1, 'manual_credit', 999, $2, $3)`,
          [memberA, memberA, nextIdem('member_self_attempt')],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

// =============================================================================
// AC5 trigger fires on cashier INSERT — time_wallets.balance_minutes updates.
// Cross-cutting integration with the trigger from t2 (0012).
// =============================================================================
describe('AC5 trigger — cashier INSERT into time_ledger updates time_wallets.balance_minutes', () => {
  it('cashier INSERT updates the target member wallet balance via the trigger', async () => {
    await withRollback(pg, async () => {
      // Snapshot baseline under service-role.
      await asServiceRole(pg);
      const before = await pg.query<{ balance_minutes: string }>(
        'SELECT balance_minutes::text AS balance_minutes FROM time_wallets WHERE profile_id = $1',
        [memberA],
      );
      const baselineMinutes = Number(before.rows[0]?.balance_minutes ?? '0');

      // Under cashier session, INSERT +75 minutes.
      await pg.query('SET ROLE app_authenticated');
      await setTestUid(pg, cashier);
      const r = (await pg.query(
        `INSERT INTO time_ledger (profile_id, action, amount_minutes, actor_id, idempotency_key)
           VALUES ($1, 'manual_credit', 75, $2, $3)`,
        [memberA, cashier, nextIdem('cashier_trigger_check')],
      )) as Results;
      expect(r.affectedRows ?? 0).toBe(1);

      // Trigger should have updated the wallet. Read under service-role to
      // bypass SELECT-policy filtering (we just want to verify the trigger
      // wrote what we expect).
      await asServiceRole(pg);
      const after = await pg.query<{ balance_minutes: string }>(
        'SELECT balance_minutes::text AS balance_minutes FROM time_wallets WHERE profile_id = $1',
        [memberA],
      );
      expect(Number(after.rows[0]?.balance_minutes)).toBe(baselineMinutes + 75);
    });
  });
});

// =============================================================================
// service-role bypass (synthesis D6) — INSERT into time_ledger succeeds and
// trigger fires. This is the Slice 2 webhook write path proof.
// =============================================================================
describe('service-role bypass — webhook write path (synthesis D6)', () => {
  it('service-role INSERT into time_ledger succeeds (no policy needed; BYPASSRLS)', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      const r = (await pg.query(
        `INSERT INTO time_ledger (profile_id, action, amount_minutes, actor_id, idempotency_key)
           VALUES ($1, 'manual_credit', 90, $2, $3)`,
        [memberA, owner, nextIdem('service_role_write')],
      )) as Results;
      expect(r.affectedRows ?? 0).toBe(1);
    });
  });

  it('service-role INSERT fires the AC5 trigger (wallet balance updates)', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      // Snapshot baseline.
      const before = await pg.query<{ balance_minutes: string }>(
        'SELECT balance_minutes::text AS balance_minutes FROM time_wallets WHERE profile_id = $1',
        [memberB],
      );
      const baselineMinutes = Number(before.rows[0]?.balance_minutes ?? '0');

      // Service-role INSERT.
      await pg.query(
        `INSERT INTO time_ledger (profile_id, action, amount_minutes, actor_id, idempotency_key)
           VALUES ($1, 'manual_credit', 33, $2, $3)`,
        [memberB, owner, nextIdem('service_role_trigger_check')],
      );

      // Wallet balance should reflect the delta.
      const after = await pg.query<{ balance_minutes: string }>(
        'SELECT balance_minutes::text AS balance_minutes FROM time_wallets WHERE profile_id = $1',
        [memberB],
      );
      expect(Number(after.rows[0]?.balance_minutes)).toBe(baselineMinutes + 33);
    });
  });
});
