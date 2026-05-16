/**
 * RLS unit tests for `memberships` (ADR-0036 Slice 1, spec AC12).
 *
 * Run locally:    pnpm test tests/db/rls-memberships.test.ts
 * Prerequisites:  none — pglite is in-process WASM Postgres.
 *
 * Spec: docs/specs/0036-payment-management-console-implementation.md AC12.
 * Migrations under test: 0001..0016 (full slice-1 schema; see rls-payments
 * test for the per-file rationale).
 *
 * The two policies pinned by AC12 (0016 line 59-71):
 *   1. memberships_self_or_cashier_read — SELECT where
 *      `profile_id = auth.uid() OR auth.role_at_least('cashier')`.
 *   2. memberships_manager_write — UPDATE USING + WITH CHECK
 *      `auth.role_at_least('manager')`.
 * NO INSERT / DELETE policy — service-role-only via Slice 2 webhook.
 *
 * Premortem R9 — `memberships.profile_id` is immutable post-INSERT. The
 * 0016 migration ships a BEFORE UPDATE trigger that raises SQLSTATE 42501
 * on any UPDATE that rewrites profile_id. The test sub-case
 * `manager UPDATE that rewrites profile_id raises 42501` documents this.
 *
 * Sub-case map (per dispatch 0017 + synthesis D5 + D6 + R9):
 *   1. structural — RLS enabled + forced; exactly two policies on memberships;
 *      memberships_profile_id_immutable_trigger present.
 *   2. SELECT: member-self-read, member-other-read empty, cashier-read-all,
 *      manager-read-all.
 *   3. UPDATE: manager succeeds, cashier silent filter (rowCount=0),
 *      member silent filter (rowCount=0).
 *   4. INSERT: every non-service-role caller denied (42501 — no INSERT policy).
 *   5. R9: manager UPDATE attempting to rewrite profile_id raises 42501.
 *   6. service-role: INSERT + UPDATE succeed (D6 — webhook write paths).
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
      email: `${label}.${id.slice(0, 8)}@memberships-rls-test.local`,
    });
    return profile.id;
  };
  memberA = await seedAs('member', 'member-a');
  memberB = await seedAs('member', 'member-b');
  cashier = await seedAs('cashier', 'cashier');
  manager = await seedAs('manager', 'manager');
  owner = await seedAs('owner', 'owner');

  // Seed one membership per member under service-role.
  await pg.query(
    `INSERT INTO memberships (profile_id, stripe_customer_id, status)
       VALUES ($1, 'cus_member_a', 'active')`,
    [memberA],
  );
  await pg.query(
    `INSERT INTO memberships (profile_id, stripe_customer_id, status)
       VALUES ($1, 'cus_member_b', 'past_due')`,
    [memberB],
  );

  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'memberships'],
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
// Structural — RLS enabled + forced; exactly two policies; profile_id
// immutability trigger present.
// =============================================================================
describe('structural — RLS posture on memberships', () => {
  it('relrowsecurity = true AND relforcerowsecurity = true', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class
        WHERE oid = 'public.memberships'::regclass`,
    );
    expect(r.rows[0]?.relrowsecurity).toBe(true);
    expect(r.rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('exactly two policies exist with the expected names', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polname: string }>(
      `SELECT polname FROM pg_policy
        WHERE polrelid = 'public.memberships'::regclass
        ORDER BY polname ASC`,
    );
    expect(r.rows.map((row) => row.polname)).toEqual([
      'memberships_manager_write',
      'memberships_self_or_cashier_read',
    ]);
  });

  it('no INSERT / DELETE policy exists on memberships (service-role-only write path)', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polcmd: string }>(
      `SELECT polcmd::text FROM pg_policy
        WHERE polrelid = 'public.memberships'::regclass`,
    );
    const cmds = r.rows.map((row) => row.polcmd);
    expect(cmds).not.toContain('a'); // INSERT
    expect(cmds).not.toContain('d'); // DELETE
  });

  it('memberships_profile_id_immutable_trigger exists (premortem R9)', async () => {
    await asServiceRole(pg);
    const trig = await pg.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE tgname = 'memberships_profile_id_immutable_trigger'
          AND NOT tgisinternal`,
    );
    expect(trig.rows.length).toBe(1);
  });
});

// =============================================================================
// SELECT — self OR cashier+ (AC12).
// =============================================================================
describe('SELECT policy — self OR cashier+', () => {
  it('memberA sees ONLY their own membership', async () => {
    await setTestUid(pg, memberA);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM memberships');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.profile_id).toBe(memberA);
  });

  it('memberB sees ONLY their own membership (cross-tenant denial)', async () => {
    await setTestUid(pg, memberB);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM memberships');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.profile_id).toBe(memberB);
  });

  it('cashier sees ALL memberships', async () => {
    await setTestUid(pg, cashier);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM memberships');
    expect(r.rows).toHaveLength(2);
  });

  it('manager sees ALL memberships', async () => {
    await setTestUid(pg, manager);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM memberships');
    expect(r.rows).toHaveLength(2);
  });

  it('owner sees ALL memberships', async () => {
    await setTestUid(pg, owner);
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM memberships');
    expect(r.rows).toHaveLength(2);
  });

  it('anon (uid cleared) sees zero rows', async () => {
    const r = await pg.query<{ profile_id: string }>('SELECT profile_id FROM memberships');
    expect(r.rows).toHaveLength(0);
  });
});

// =============================================================================
// UPDATE — manager+ only; cashier and members silent-filter (no policy).
// =============================================================================
describe('UPDATE policy — manager+ only', () => {
  it('manager UPDATE succeeds (membership-override surface)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      const upd = (await pg.query(
        `UPDATE memberships SET status = 'canceled' WHERE profile_id = $1`,
        [memberA],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);

      const after = await pg.query<{ status: string }>(
        'SELECT status FROM memberships WHERE profile_id = $1',
        [memberA],
      );
      expect(after.rows[0]?.status).toBe('canceled');
    });
  });

  it('owner UPDATE succeeds (above-manager threshold)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, owner);
      const upd = (await pg.query(
        `UPDATE memberships SET status = 'canceled' WHERE profile_id = $1`,
        [memberB],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);
    });
  });

  it('cashier UPDATE affects zero rows (silent filter — below threshold)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, cashier);
      const upd = (await pg.query(
        `UPDATE memberships SET status = 'canceled' WHERE profile_id = $1`,
        [memberA],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);

      // Post-state: original status preserved.
      await asServiceRole(pg);
      const after = await pg.query<{ status: string }>(
        'SELECT status FROM memberships WHERE profile_id = $1',
        [memberA],
      );
      expect(after.rows[0]?.status).toBe('active');
    });
  });

  it('member UPDATE of own row affects zero rows (silent filter)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      const upd = (await pg.query(
        `UPDATE memberships SET status = 'canceled' WHERE profile_id = $1`,
        [memberA],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);
    });
  });
});

// =============================================================================
// Premortem R9 — memberships.profile_id is immutable post-INSERT. Manager+
// UPDATE that rewrites profile_id is blocked by the trigger (raises 42501).
// =============================================================================
describe('premortem R9 — memberships.profile_id immutability', () => {
  it('manager UPDATE attempting to rewrite profile_id raises 42501 (trigger guard)', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      await expect(
        pg.query(`UPDATE memberships SET profile_id = $1 WHERE profile_id = $2`, [
          memberB,
          memberA,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('owner UPDATE attempting to rewrite profile_id raises 42501 (trigger fires regardless of role)', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, owner);
      await expect(
        pg.query(`UPDATE memberships SET profile_id = $1 WHERE profile_id = $2`, [
          memberA,
          memberB,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('manager UPDATE that does NOT touch profile_id succeeds (sanity)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      const upd = (await pg.query(
        `UPDATE memberships SET status = 'past_due' WHERE profile_id = $1`,
        [memberA],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);
    });
  });
});

// =============================================================================
// INSERT — no policy → 42501 for every non-service-role caller.
// =============================================================================
describe('INSERT — no policy exists; every non-service-role caller is denied (42501)', () => {
  it('manager INSERT denied with SQLSTATE 42501', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      await expect(
        pg.query(
          `INSERT INTO memberships (profile_id, stripe_customer_id, status)
             VALUES ($1, 'cus_attempt', 'active')`,
          [cashier],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('cashier INSERT denied with SQLSTATE 42501', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, cashier);
      await expect(
        pg.query(
          `INSERT INTO memberships (profile_id, stripe_customer_id, status)
             VALUES ($1, 'cus_attempt', 'active')`,
          [manager],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('member INSERT denied with SQLSTATE 42501', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, memberA);
      await expect(
        pg.query(
          `INSERT INTO memberships (profile_id, stripe_customer_id, status)
             VALUES ($1, 'cus_self_attempt', 'active')`,
          [memberA],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

// =============================================================================
// service-role bypass (synthesis D6) — INSERT + UPDATE succeed. Webhook write
// path + membership-override post-webhook path.
// =============================================================================
describe('service-role bypass — webhook + override write paths (synthesis D6)', () => {
  it('service-role INSERT succeeds (no policy needed; BYPASSRLS)', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      // Use cashier as the new profile id — no existing membership row.
      const r = (await pg.query(
        `INSERT INTO memberships (profile_id, stripe_customer_id, status)
           VALUES ($1, 'cus_service_role_write', 'active')`,
        [cashier],
      )) as Results;
      expect(r.affectedRows ?? 0).toBe(1);
    });
  });

  it('service-role UPDATE succeeds (webhook handler write path for status transitions)', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      const upd = (await pg.query(
        `UPDATE memberships SET status = 'past_due' WHERE profile_id = $1`,
        [memberA],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);
    });
  });
});
