/**
 * RLS unit tests for `payments` (ADR-0036 Slice 1, spec AC11).
 *
 * Run locally:    pnpm test tests/db/rls-payments.test.ts
 * Prerequisites:  none — pglite is in-process WASM Postgres.
 *
 * Spec: docs/specs/0036-payment-management-console-implementation.md AC11.
 * Migrations under test:
 *   - supabase/migrations/0001_feature_flags.sql       (cycle 1)
 *   - supabase/migrations/0002_profiles_and_roles.sql  (role ladder + auth.role_at_least)
 *   - supabase/migrations/0003_audit_log.sql           (cycle 2)
 *   - supabase/migrations/0004_privacy_soft_delete.sql (pgcrypto + soft-delete)
 *   - supabase/migrations/0005_privacy_requests.sql
 *   - supabase/migrations/0006_feature_flags_rls.sql
 *   - supabase/migrations/0007_clubs_and_display_tz.sql
 *   - supabase/migrations/0008_payments.sql            (table under test — ENABLE+FORCE RLS)
 *   - supabase/migrations/0009..0015                   (sibling slice-1 schema)
 *   - supabase/migrations/0016_payments_rls.sql        (policy under test)
 *
 * The single policy pinned by AC11 (0016 line 51-53):
 *   - payments_self_or_cashier_read — SELECT where
 *     `profile_id = auth.uid() OR auth.role_at_least('cashier')`.
 * NO INSERT/UPDATE/DELETE policy — service-role-only write path via the
 * Slice 2 webhook handler (BYPASSRLS).
 *
 * Sub-case map (per dispatch 0017 + synthesis D5 + D6):
 *   1. structural — RLS enabled + forced; exactly one policy named
 *      `payments_self_or_cashier_read`.
 *   2. SELECT: member-A sees own row, member-B sees own row, cashier sees all,
 *      manager sees all, anon (uid cleared) sees zero rows.
 *   3. INSERT: members + cashier + manager are denied (42501 — no INSERT
 *      policy → RLS denies non-bypass writes).
 *   4. UPDATE: member-context UPDATE returns rowCount=0 (silent filter — no
 *      UPDATE policy).
 *   5. DELETE: every non-service-role DELETE returns rowCount=0 (no DELETE
 *      policy).
 *   6. service-role: INSERT succeeds (D6 — webhook write path proof).
 *   7. premortem risk R7 — member-context FK violation on another member's
 *      payment_id does NOT disclose row contents in the error message.
 *
 * Assertion contract (synthesis D5):
 *   - INSERT-deny → `rejects.toMatchObject({ code: '42501' })`
 *   - UPDATE/DELETE-deny → `affectedRows === 0`
 *   - SELECT-deny against own-context → `data.length === 0`
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

// All 16 slice-1 migrations in dependency order. 0008..0015 + 0016 are the
// payments-slice substrate; 0001..0007 are upstream cycle-1/cycle-2 substrate
// the slice depends on (profiles, auth.role_at_least, audit_log, etc.).
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

// Seeded ids — populated in beforeAll.
let memberA = '';
let memberB = '';
let cashier = '';
let manager = '';
let owner = '';

// Seeded payment ids — populated in beforeAll. memberA owns paymentA; memberB
// owns paymentB. These are used by the SELECT denial / disclosure tests.
let paymentA = 0;
let paymentB = 0;

beforeAll(async () => {
  pg = new PGlite({ extensions: { pgcrypto } });

  await setupAuthStub(pg);

  // Stub auth.users — production Supabase ships this; pglite does not.
  await runSqlBlock(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `);

  // Apply migrations 0001..0016 in order so the full slice-1 schema is
  // present (the payments table + RLS policies depend on 0001..0007 + the
  // 0008..0015 sibling tables; 0016 ships the actual policies).
  for (const name of MIGRATIONS) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
    await runSqlBlock(sql);
  }

  // Seed profiles. Service-role context (uid cleared by setupAuthStub).
  const seedAs = async (
    role: 'member' | 'cashier' | 'manager' | 'owner',
    label: string,
  ): Promise<string> => {
    const u = await pg.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
    const id = u.rows[0]!.id;
    const profile = await seedProfile(pg, {
      id,
      role,
      email: `${label}.${id.slice(0, 8)}@payments-rls-test.local`,
    });
    return profile.id;
  };
  memberA = await seedAs('member', 'member-a');
  memberB = await seedAs('member', 'member-b');
  cashier = await seedAs('cashier', 'cashier');
  manager = await seedAs('manager', 'manager');
  owner = await seedAs('owner', 'owner');

  // Seed one payment per member under service-role so the SELECT sub-cases
  // have rows to filter. The literal values in stripe_object_id / amount_cents
  // are pinned because the premortem R7 disclosure test asserts they do NOT
  // appear in any member-context error message.
  const insertA = await pg.query<{ id: string }>(
    `INSERT INTO payments (
       stripe_object_id, kind, profile_id, amount_cents, currency, status, stripe_event_id, idempotency_key
     ) VALUES (
       'pi_member_a_secret_value', 'membership', $1, 5000, 'usd', 'succeeded', 'evt_member_a', 'idem_member_a'
     ) RETURNING id`,
    [memberA],
  );
  paymentA = Number(insertA.rows[0]!.id);

  const insertB = await pg.query<{ id: string }>(
    `INSERT INTO payments (
       stripe_object_id, kind, profile_id, amount_cents, currency, status, stripe_event_id, idempotency_key
     ) VALUES (
       'pi_member_b_secret_value', 'time_topup', $1, 7777, 'usd', 'succeeded', 'evt_member_b', 'idem_member_b'
     ) RETURNING id`,
    [memberB],
  );
  paymentB = Number(insertB.rows[0]!.id);

  // Grant the app_authenticated role access to payments + the role-ladder
  // helper. profiles is included so the SECURITY DEFINER auth.role_at_least
  // function can read the role column for the authenticated session.
  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'payments'],
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
// Structural — RLS enabled + forced; exactly one policy named
// payments_self_or_cashier_read; no INSERT / UPDATE / DELETE policies.
// =============================================================================
describe('structural — RLS posture on payments', () => {
  it('relrowsecurity = true AND relforcerowsecurity = true', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class
        WHERE oid = 'public.payments'::regclass`,
    );
    expect(r.rows[0]?.relrowsecurity).toBe(true);
    expect(r.rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('exactly one policy exists with the expected name (payments_self_or_cashier_read)', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polname: string; polcmd: string }>(
      `SELECT polname, polcmd::text FROM pg_policy
        WHERE polrelid = 'public.payments'::regclass
        ORDER BY polname ASC`,
    );
    expect(r.rows.map((row) => row.polname)).toEqual(['payments_self_or_cashier_read']);
    // polcmd 'r' = SELECT.
    expect(r.rows[0]?.polcmd).toBe('r');
  });

  it('no INSERT / UPDATE / DELETE policy exists on payments (service-role-only write path)', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polcmd: string }>(
      `SELECT polcmd::text FROM pg_policy
        WHERE polrelid = 'public.payments'::regclass`,
    );
    // polcmd codes: 'r' SELECT, 'a' INSERT, 'w' UPDATE, 'd' DELETE, '*' ALL.
    const cmds = r.rows.map((row) => row.polcmd);
    expect(cmds).not.toContain('a');
    expect(cmds).not.toContain('w');
    expect(cmds).not.toContain('d');
  });
});

// =============================================================================
// SELECT — self OR cashier+ (AC11).
// =============================================================================
describe('SELECT policy — self OR cashier+', () => {
  it('memberA sees ONLY their own payment', async () => {
    await setTestUid(pg, memberA);
    const r = await pg.query<{ profile_id: string; stripe_object_id: string }>(
      'SELECT profile_id, stripe_object_id FROM payments ORDER BY id',
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.profile_id).toBe(memberA);
    expect(r.rows[0]?.stripe_object_id).toBe('pi_member_a_secret_value');
  });

  it('memberB sees ONLY their own payment (cross-tenant denial)', async () => {
    await setTestUid(pg, memberB);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM payments ORDER BY id');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.profile_id).toBe(memberB);
  });

  it('cashier sees ALL payments', async () => {
    await setTestUid(pg, cashier);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM payments ORDER BY id');
    expect(r.rows).toHaveLength(2);
  });

  it('manager sees ALL payments', async () => {
    await setTestUid(pg, manager);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM payments ORDER BY id');
    expect(r.rows).toHaveLength(2);
  });

  it('owner sees ALL payments', async () => {
    await setTestUid(pg, owner);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM payments');
    expect(r.rows).toHaveLength(2);
  });

  it('anon (uid cleared) sees zero rows (SELECT-deny → data.length === 0)', async () => {
    // beforeEach already cleared uid and set role to app_authenticated.
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM payments');
    expect(r.rows).toHaveLength(0);
  });
});

// =============================================================================
// INSERT — no policy → 42501 for every non-service-role role.
// =============================================================================
describe('INSERT — no policy exists; every non-service-role caller is denied (42501)', () => {
  it('member INSERT denied with SQLSTATE 42501', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      await expect(
        pg.query(
          `INSERT INTO payments (
             stripe_object_id, kind, profile_id, amount_cents, currency, status, stripe_event_id
           ) VALUES (
             'pi_member_self_attempt', 'membership', $1, 1000, 'usd', 'succeeded', 'evt_member_self'
           )`,
          [memberA],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('cashier INSERT denied with SQLSTATE 42501 (service-role-only write path)', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, cashier);
      await expect(
        pg.query(
          `INSERT INTO payments (
             stripe_object_id, kind, profile_id, amount_cents, currency, status, stripe_event_id
           ) VALUES (
             'pi_cashier_attempt', 'membership', $1, 1000, 'usd', 'succeeded', 'evt_cashier_attempt'
           )`,
          [memberA],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('manager INSERT denied with SQLSTATE 42501', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      await expect(
        pg.query(
          `INSERT INTO payments (
             stripe_object_id, kind, profile_id, amount_cents, currency, status, stripe_event_id
           ) VALUES (
             'pi_manager_attempt', 'membership', $1, 1000, 'usd', 'succeeded', 'evt_manager_attempt'
           )`,
          [memberA],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

// =============================================================================
// UPDATE — no UPDATE policy → silent filter (rowCount=0) for every member /
// staff role. Service-role bypass is the only mutation path (and only the
// webhook handler should be in service-role context).
// =============================================================================
describe('UPDATE — no UPDATE policy; RLS silent filter (affectedRows === 0)', () => {
  it('member UPDATE of own payment affects zero rows (silent filter)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      const upd = (await pg.query(`UPDATE payments SET status = 'refunded' WHERE profile_id = $1`, [
        memberA,
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);

      // Post-state: original status preserved (verified under service-role).
      await asServiceRole(pg);
      const after = await pg.query<{ status: string }>(
        'SELECT status FROM payments WHERE profile_id = $1',
        [memberA],
      );
      expect(after.rows[0]?.status).toBe('succeeded');
    });
  });

  it('manager UPDATE affects zero rows (no UPDATE policy exists)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      const upd = (await pg.query(`UPDATE payments SET status = 'refunded' WHERE id = $1`, [
        paymentA,
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);
    });
  });
});

// =============================================================================
// DELETE — no DELETE policy → silent filter for every non-service-role role.
// =============================================================================
describe('DELETE — no policy; silent filter for non-service-role roles', () => {
  it('member DELETE affects zero rows', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      const del = (await pg.query(`DELETE FROM payments WHERE profile_id = $1`, [
        memberA,
      ])) as Results;
      expect(del.affectedRows ?? 0).toBe(0);
    });
  });

  it('manager DELETE affects zero rows (no manager DELETE policy)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      const del = (await pg.query(`DELETE FROM payments WHERE id = $1`, [paymentA])) as Results;
      expect(del.affectedRows ?? 0).toBe(0);
    });
  });
});

// =============================================================================
// service-role bypass (synthesis D6) — INSERT succeeds. This is the webhook
// handler's write path; if a future migration accidentally tightens this,
// the Slice 2 webhook handler regresses silently.
// =============================================================================
describe('service-role bypass — webhook write path (synthesis D6)', () => {
  it('service-role INSERT succeeds (no policy needed; BYPASSRLS)', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      const r = (await pg.query(
        `INSERT INTO payments (
           stripe_object_id, kind, profile_id, amount_cents, currency, status, stripe_event_id
         ) VALUES (
           'pi_service_role_write', 'membership', $1, 5000, 'usd', 'succeeded', 'evt_service_role_write'
         )`,
        [memberA],
      )) as Results;
      expect(r.affectedRows ?? 0).toBe(1);

      // Sanity: the inserted row is readable under service-role.
      const after = await pg.query<{ profile_id: string }>(
        `SELECT profile_id FROM payments WHERE stripe_object_id = 'pi_service_role_write'`,
      );
      expect(after.rows[0]?.profile_id).toBe(memberA);
    });
  });
});

// =============================================================================
// Premortem risk R7 — member-context FK violation on another member's payment
// id does NOT disclose row contents in the error message.
//
// Vector: a member attempts to INSERT into time_ledger with
// source_payment_id pointing to another member's payment row. The INSERT is
// denied by RLS (time_ledger has no member-level INSERT policy — only
// cashier+), so we expect a 42501. CRITICAL: regardless of whether the
// failure comes from the cashier-gate or an FK message, the error text MUST
// NOT include another member's stripe_object_id or amount_cents values.
//
// This documents the broader posture: any future Postgres / driver upgrade
// that starts surfacing row-detail strings in error messages would break this
// test and force re-engagement with the error-redaction posture.
// =============================================================================
describe('premortem R7 — member-context errors do NOT disclose other-member row contents', () => {
  it('member INSERT into time_ledger referencing another member payment id does NOT leak values', async () => {
    expect.assertions(4);
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      try {
        await pg.query(
          `INSERT INTO time_ledger (
             profile_id, action, amount_minutes, source_payment_id, idempotency_key
           ) VALUES (
             $1, 'purchase', 60, $2, 'idem_member_a_probe'
           )`,
          [memberA, paymentB],
        );
        throw new Error('expected RLS / FK denial — INSERT unexpectedly succeeded');
      } catch (err) {
        const message = (err as Error).message ?? '';
        // SECRET values from memberB's payment row MUST NOT appear in the
        // error text. Any future RLS / driver / Postgres upgrade that starts
        // leaking row values trips these asserts and forces re-engagement.
        expect(message).not.toMatch(/pi_member_b_secret_value/);
        expect(message).not.toMatch(/7777/);
        expect(message).not.toMatch(/evt_member_b/);
        expect(message).not.toMatch(/idem_member_b/);
      }
    });
  });
});
