/**
 * RLS unit tests for `refund_requests` (ADR-0036 Slice 1, spec AC14).
 *
 * Run locally:    pnpm test tests/db/rls-refund-requests.test.ts
 * Prerequisites:  none — pglite is in-process WASM Postgres.
 *
 * Spec: docs/specs/0036-payment-management-console-implementation.md AC14.
 * Migrations under test: 0001..0016 (full slice-1 schema).
 *
 * The two policies pinned by AC14 (0016 line 145-151):
 *   1. refund_requests_manager_read   — SELECT for manager+ ONLY (operational
 *      table, NOT member-facing). Members get zero rows even on their own
 *      profile_id.
 *   2. refund_requests_manager_insert — INSERT WITH CHECK manager+.
 * NO UPDATE / DELETE policy. Premortem R5: the absence of an UPDATE policy
 * is LOAD-BEARING. The Slice 2 webhook handler transitions
 * `status` via service-role BYPASSRLS; the contrast test below asserts that
 * a future Slice 2 worker who naively adds an UPDATE policy will trip the
 * test count assertion.
 *
 * Sub-case map (per dispatch 0017 + synthesis D5 + D6 + premortem R5):
 *   1. structural — RLS+FORCE, exactly two policies, no UPDATE / DELETE.
 *   2. SELECT: member-self-read returns EMPTY (operational table), manager
 *      reads all, owner reads all, cashier reads zero, anon reads zero.
 *   3. INSERT: manager succeeds, owner succeeds, cashier denied (42501),
 *      member denied (42501).
 *   4. UPDATE: no policy → manager UPDATE on existing row affects zero rows
 *      (silent filter). Contrast with service-role UPDATE which succeeds
 *      (Slice 2 webhook write path).
 *   5. service-role: INSERT succeeds + UPDATE succeeds (D6).
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
let cashier = '';
let manager = '';
let owner = '';

// Seeded refund_requests row id (under service-role). Used by the UPDATE
// silent-filter tests + the service-role UPDATE proof.
let seedRefundId = 0;

// Seeded payment id — refund_requests rows reference this via target_payment_id.
let targetPaymentId = 0;

// Unique idempotency-key counter — refund_requests has a UNIQUE on
// idempotency_key. Every INSERT in this file must use a distinct value.
let idemSeq = 0;
function nextIdem(label: string): string {
  idemSeq += 1;
  return `idem_refund_${label}_${idemSeq}`;
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
      email: `${label}.${id.slice(0, 8)}@refund-rls-test.local`,
    });
    return profile.id;
  };
  memberA = await seedAs('member', 'member-a');
  cashier = await seedAs('cashier', 'cashier');
  manager = await seedAs('manager', 'manager');
  owner = await seedAs('owner', 'owner');

  // Seed a payment that the refund_requests rows can reference. memberA owns it.
  const paymentRes = await pg.query<{ id: string }>(
    `INSERT INTO payments (
       stripe_object_id, kind, profile_id, amount_cents, currency, status, stripe_event_id
     ) VALUES (
       'pi_refund_target', 'time_topup', $1, 2500, 'usd', 'succeeded', 'evt_refund_target'
     ) RETURNING id`,
    [memberA],
  );
  targetPaymentId = Number(paymentRes.rows[0]!.id);

  // Seed one refund_request under service-role (actor = manager). The
  // operational-table SELECT denial test needs this row to filter against.
  const seedRes = await pg.query<{ id: string }>(
    `INSERT INTO refund_requests (
       target_payment_id, profile_id, actor_id, refund_type, amount_cents, reason, status, idempotency_key
     ) VALUES (
       $1, $2, $3, 'time_bank', 1500, 'goodwill', 'pending', $4
     ) RETURNING id`,
    [targetPaymentId, memberA, manager, nextIdem('seed')],
  );
  seedRefundId = Number(seedRes.rows[0]!.id);

  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'payments', 'refund_requests'],
    sequences: ['refund_requests_id_seq'],
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
// Structural — RLS+FORCE; exactly two policies; no UPDATE/DELETE policy.
// =============================================================================
describe('structural — RLS posture on refund_requests', () => {
  it('relrowsecurity = true AND relforcerowsecurity = true', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE oid = 'public.refund_requests'::regclass`,
    );
    expect(r.rows[0]?.relrowsecurity).toBe(true);
    expect(r.rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('exactly two policies (SELECT + INSERT) with manager+ predicates', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polname: string }>(
      `SELECT polname FROM pg_policy
        WHERE polrelid = 'public.refund_requests'::regclass
        ORDER BY polname ASC`,
    );
    expect(r.rows.map((row) => row.polname)).toEqual([
      'refund_requests_manager_insert',
      'refund_requests_manager_read',
    ]);
  });

  it('no UPDATE or DELETE policy exists (premortem R5 — load-bearing absence)', async () => {
    // LOAD-BEARING — DO NOT add an UPDATE policy reactively. The Slice 2
    // webhook handler transitions status via service-role BYPASSRLS. Adding
    // an UPDATE policy here without re-engaging the authority matrix in
    // lib/payments/authority.ts and the audit-pairing invariant in ADR-0006
    // would silently allow manager+ users to mark a failed refund as
    // succeeded (refund-replay vector). See premortem R5.
    await asServiceRole(pg);
    const r = await pg.query<{ polcmd: string }>(
      `SELECT polcmd::text FROM pg_policy
        WHERE polrelid = 'public.refund_requests'::regclass`,
    );
    const cmds = r.rows.map((row) => row.polcmd);
    expect(cmds).not.toContain('w'); // UPDATE
    expect(cmds).not.toContain('d'); // DELETE
  });
});

// =============================================================================
// SELECT — manager+ ONLY. refund_requests is operational, NOT member-facing
// (members never see their own refund row through this table — the member-
// facing UI is the payment row's `status='refunded'` projection).
// =============================================================================
describe('SELECT policy — manager+ only (operational table, NOT member-facing)', () => {
  it('member-self-read returns EMPTY (operational table, not member-facing)', async () => {
    await setTestUid(pg, memberA);
    const r = await pg.query<{ profile_id: string }>(
      'SELECT profile_id FROM refund_requests WHERE profile_id = $1',
      [memberA],
    );
    expect(r.rows).toHaveLength(0);
  });

  it('cashier-read returns EMPTY (below manager threshold)', async () => {
    await setTestUid(pg, cashier);
    const r = await pg.query<{ id: string }>('SELECT id FROM refund_requests');
    expect(r.rows).toHaveLength(0);
  });

  it('manager-read returns ALL rows', async () => {
    await setTestUid(pg, manager);
    const r = await pg.query<{ id: string }>('SELECT id FROM refund_requests');
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('owner-read returns ALL rows', async () => {
    await setTestUid(pg, owner);
    const r = await pg.query<{ id: string }>('SELECT id FROM refund_requests');
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('anon (uid cleared) sees zero rows', async () => {
    const r = await pg.query<{ id: string }>('SELECT id FROM refund_requests');
    expect(r.rows).toHaveLength(0);
  });
});

// =============================================================================
// INSERT — manager+ only at the RLS layer. The fine-grained authority tier
// (cashier ≤ $25 time-bank, etc. per ADR-0027) is enforced in
// lib/payments/authority.ts — NOT in RLS.
// =============================================================================
describe('INSERT policy — manager+ at RLS layer (authority tier is app-layer)', () => {
  it('manager INSERT succeeds', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      const r = (await pg.query(
        `INSERT INTO refund_requests (
           target_payment_id, profile_id, actor_id, refund_type, amount_cents, reason, idempotency_key
         ) VALUES (
           $1, $2, $3, 'time_bank', 500, 'goodwill', $4
         )`,
        [targetPaymentId, memberA, manager, nextIdem('manager_insert')],
      )) as Results;
      expect(r.affectedRows ?? 0).toBe(1);
    });
  });

  it('owner INSERT succeeds (above-manager threshold)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, owner);
      const r = (await pg.query(
        `INSERT INTO refund_requests (
           target_payment_id, profile_id, actor_id, refund_type, amount_cents, reason, idempotency_key
         ) VALUES (
           $1, $2, $3, 'time_bank', 1000, 'fraudulent', $4
         )`,
        [targetPaymentId, memberA, owner, nextIdem('owner_insert')],
      )) as Results;
      expect(r.affectedRows ?? 0).toBe(1);
    });
  });

  it('cashier INSERT denied with SQLSTATE 42501 (below threshold)', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, cashier);
      await expect(
        pg.query(
          `INSERT INTO refund_requests (
             target_payment_id, profile_id, actor_id, refund_type, amount_cents, reason, idempotency_key
           ) VALUES (
             $1, $2, $3, 'time_bank', 500, 'goodwill', $4
           )`,
          [targetPaymentId, memberA, cashier, nextIdem('cashier_attempt')],
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
          `INSERT INTO refund_requests (
             target_payment_id, profile_id, actor_id, refund_type, amount_cents, reason, idempotency_key
           ) VALUES (
             $1, $2, $3, 'time_bank', 500, 'goodwill', $4
           )`,
          [targetPaymentId, memberA, memberA, nextIdem('member_attempt')],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

// =============================================================================
// UPDATE — no policy → silent filter for manager+ (premortem R5 contrast).
// The webhook handler transitions status via service-role BYPASSRLS.
// =============================================================================
describe('UPDATE — no policy; silent filter for manager+ (premortem R5)', () => {
  it('manager UPDATE on existing row affects zero rows (no UPDATE policy)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      const upd = (await pg.query(`UPDATE refund_requests SET status = 'settled' WHERE id = $1`, [
        seedRefundId,
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);

      // Post-state: original status preserved.
      await asServiceRole(pg);
      const after = await pg.query<{ status: string }>(
        'SELECT status FROM refund_requests WHERE id = $1',
        [seedRefundId],
      );
      expect(after.rows[0]?.status).toBe('pending');
    });
  });

  it('owner UPDATE affects zero rows (no policy for any non-service-role role)', async () => {
    await withRollback(pg, async () => {
      await setTestUid(pg, owner);
      const upd = (await pg.query(`UPDATE refund_requests SET status = 'settled' WHERE id = $1`, [
        seedRefundId,
      ])) as Results;
      expect(upd.affectedRows ?? 0).toBe(0);
    });
  });
});

// =============================================================================
// service-role bypass (synthesis D6) — INSERT + UPDATE succeed. The webhook
// handler write path proof (Slice 2 will transition status='settled').
// =============================================================================
describe('service-role bypass — webhook write path (synthesis D6 + premortem R5)', () => {
  it('service-role INSERT succeeds (no policy needed; BYPASSRLS)', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      const r = (await pg.query(
        `INSERT INTO refund_requests (
           target_payment_id, profile_id, actor_id, refund_type, amount_cents, reason, idempotency_key
         ) VALUES (
           $1, $2, $3, 'time_bank', 750, 'goodwill', $4
         )`,
        [targetPaymentId, memberA, manager, nextIdem('service_role_insert')],
      )) as Results;
      expect(r.affectedRows ?? 0).toBe(1);
    });
  });

  it('service-role UPDATE succeeds (Slice 2 webhook will write status=settled)', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      const upd = (await pg.query(
        `UPDATE refund_requests SET status = 'settled', settled_at = now() WHERE id = $1`,
        [seedRefundId],
      )) as Results;
      expect(upd.affectedRows ?? 0).toBe(1);

      const after = await pg.query<{ status: string }>(
        'SELECT status FROM refund_requests WHERE id = $1',
        [seedRefundId],
      );
      expect(after.rows[0]?.status).toBe('settled');
    });
  });
});
