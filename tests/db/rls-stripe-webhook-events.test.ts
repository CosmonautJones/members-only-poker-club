/**
 * RLS unit tests for `stripe_webhook_events` (ADR-0036 Slice 1, spec AC15).
 *
 * Run locally:    pnpm test tests/db/rls-stripe-webhook-events.test.ts
 * Prerequisites:  none — pglite is in-process WASM Postgres.
 *
 * Spec: docs/specs/0036-payment-management-console-implementation.md AC15.
 * Migrations under test: 0001..0016 (full slice-1 schema).
 *
 * The single policy pinned by AC15 (0016 line 180-182):
 *   - stripe_webhook_events_manager_read — SELECT for manager+ ONLY.
 * NO INSERT / UPDATE / DELETE policy. Writes are SERVICE-ROLE-ONLY via the
 * Slice 2 webhook handler (BYPASSRLS). The absence of an INSERT policy is
 * the load-bearing enforcement that ONLY the webhook handler can append.
 *
 * Premortem R10 note: manager+ read on `payload` (jsonb) is intentional per
 * ADR-0022 (Stripe payloads contain PII — billing email, last4, address —
 * but operator-side data is OK for manager+). The audit-on-read pairing is
 * a Slice 2 follow-up, NOT in scope here.
 *
 * Sub-case map (per dispatch 0017 + synthesis D5 + D6):
 *   1. structural — RLS+FORCE, exactly one policy, no INSERT/UPDATE/DELETE.
 *   2. SELECT: manager reads all, owner reads all, cashier reads zero,
 *      member reads zero, anon reads zero.
 *   3. INSERT: manager denied (42501) — service-role only; cashier denied;
 *      member denied.
 *   4. service-role: INSERT succeeds (D6 — THE main write surface in Slice 2).
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

// Unique event-id counter — stripe_webhook_events.event_id is PK.
let evtSeq = 0;
function nextEventId(label: string): string {
  evtSeq += 1;
  return `evt_${label}_${evtSeq}`;
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
      email: `${label}.${id.slice(0, 8)}@webhook-rls-test.local`,
    });
    return profile.id;
  };
  memberA = await seedAs('member', 'member-a');
  cashier = await seedAs('cashier', 'cashier');
  manager = await seedAs('manager', 'manager');
  owner = await seedAs('owner', 'owner');

  // Seed two webhook events under service-role so the SELECT sub-cases have
  // rows to filter against.
  await pg.query(
    `INSERT INTO stripe_webhook_events (event_id, event_type, livemode, payload)
       VALUES ($1, 'payment_intent.succeeded', false, '{"id":"evt_seed_1"}'::jsonb)`,
    [nextEventId('seed_1')],
  );
  await pg.query(
    `INSERT INTO stripe_webhook_events (event_id, event_type, livemode, payload)
       VALUES ($1, 'charge.dispute.created', false, '{"id":"evt_seed_2"}'::jsonb)`,
    [nextEventId('seed_2')],
  );

  await setupAppAuthenticatedRole(pg, {
    tables: ['profiles', 'stripe_webhook_events'],
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
// Structural — RLS+FORCE; exactly one SELECT policy; no INSERT/UPDATE/DELETE.
// =============================================================================
describe('structural — RLS posture on stripe_webhook_events', () => {
  it('relrowsecurity = true AND relforcerowsecurity = true', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE oid = 'public.stripe_webhook_events'::regclass`,
    );
    expect(r.rows[0]?.relrowsecurity).toBe(true);
    expect(r.rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('exactly one policy exists (stripe_webhook_events_manager_read)', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polname: string; polcmd: string }>(
      `SELECT polname, polcmd::text FROM pg_policy
        WHERE polrelid = 'public.stripe_webhook_events'::regclass
        ORDER BY polname ASC`,
    );
    expect(r.rows.map((row) => row.polname)).toEqual(['stripe_webhook_events_manager_read']);
    expect(r.rows[0]?.polcmd).toBe('r');
  });

  it('no INSERT / UPDATE / DELETE policy (service-role-only write path)', async () => {
    await asServiceRole(pg);
    const r = await pg.query<{ polcmd: string }>(
      `SELECT polcmd::text FROM pg_policy
        WHERE polrelid = 'public.stripe_webhook_events'::regclass`,
    );
    const cmds = r.rows.map((row) => row.polcmd);
    expect(cmds).not.toContain('a');
    expect(cmds).not.toContain('w');
    expect(cmds).not.toContain('d');
  });
});

// =============================================================================
// SELECT — manager+ ONLY.
// =============================================================================
describe('SELECT policy — manager+ only', () => {
  it('manager-read returns rows', async () => {
    await setTestUid(pg, manager);
    const r = await pg.query<{ event_id: string }>('SELECT event_id FROM stripe_webhook_events');
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('owner-read returns rows (above-manager threshold)', async () => {
    await setTestUid(pg, owner);
    const r = await pg.query<{ event_id: string }>('SELECT event_id FROM stripe_webhook_events');
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('cashier-read returns EMPTY (below manager threshold)', async () => {
    await setTestUid(pg, cashier);
    const r = await pg.query<{ event_id: string }>('SELECT event_id FROM stripe_webhook_events');
    expect(r.rows).toHaveLength(0);
  });

  it('member-read returns EMPTY (no member access — operator-side data)', async () => {
    await setTestUid(pg, memberA);
    const r = await pg.query<{ event_id: string }>('SELECT event_id FROM stripe_webhook_events');
    expect(r.rows).toHaveLength(0);
  });

  it('anon (uid cleared) sees zero rows', async () => {
    const r = await pg.query<{ event_id: string }>('SELECT event_id FROM stripe_webhook_events');
    expect(r.rows).toHaveLength(0);
  });
});

// =============================================================================
// INSERT — no policy → 42501 for every non-service-role caller, including
// manager+. Writes are EXCLUSIVELY the webhook handler in Slice 2.
// =============================================================================
describe('INSERT — service-role only (every non-service-role caller is denied)', () => {
  it('manager INSERT denied with SQLSTATE 42501', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, manager);
      await expect(
        pg.query(
          `INSERT INTO stripe_webhook_events (event_id, event_type, livemode, payload)
             VALUES ($1, 'payment_intent.succeeded', false, '{}'::jsonb)`,
          [nextEventId('manager_attempt')],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('owner INSERT denied with SQLSTATE 42501 (no admin-INSERT path even for owner)', async () => {
    expect.assertions(1);
    await withRollback(pg, async () => {
      await setTestUid(pg, owner);
      await expect(
        pg.query(
          `INSERT INTO stripe_webhook_events (event_id, event_type, livemode, payload)
             VALUES ($1, 'payment_intent.succeeded', false, '{}'::jsonb)`,
          [nextEventId('owner_attempt')],
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
          `INSERT INTO stripe_webhook_events (event_id, event_type, livemode, payload)
             VALUES ($1, 'payment_intent.succeeded', false, '{}'::jsonb)`,
          [nextEventId('cashier_attempt')],
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
          `INSERT INTO stripe_webhook_events (event_id, event_type, livemode, payload)
             VALUES ($1, 'payment_intent.succeeded', false, '{}'::jsonb)`,
          [nextEventId('member_attempt')],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

// =============================================================================
// service-role bypass (synthesis D6) — INSERT succeeds. This is THE primary
// write surface in Slice 2 — every Stripe webhook lands a row here as the
// idempotency anchor per ADR-0005.
// =============================================================================
describe('service-role bypass — webhook write path (synthesis D6)', () => {
  it('service-role INSERT succeeds (no policy needed; BYPASSRLS)', async () => {
    await withRollback(pg, async () => {
      await asServiceRole(pg);
      const r = (await pg.query(
        `INSERT INTO stripe_webhook_events (event_id, event_type, livemode, payload)
           VALUES ($1, 'payment_intent.succeeded', false, '{"id":"evt_service_role_write"}'::jsonb)`,
        [nextEventId('service_role_write')],
      )) as Results;
      expect(r.affectedRows ?? 0).toBe(1);
    });
  });
});
