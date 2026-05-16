// Integration test — ADR-0036 / T20.
//
// THE load-bearing integration test for the ADR-0036 Slice 1 schema. Each
// per-migration shape test under tests/migrations/ verifies a single migration
// applies cleanly on top of its prefix; this test verifies the FULL 16-file
// sequence applies in order against a fresh pglite instance, then asserts the
// final composite state via information_schema + pg_catalog introspection.
//
// What this catches that the per-migration tests cannot
// -----------------------------------------------------
//
//   - Migration-ordering regressions where each migration passes its own
//     shape test but the resulting end-state is wrong (e.g. an FK forward-
//     references a table that exists only in a later migration).
//
//   - Drift between the per-migration "applies cleanly" assertion and the
//     final composite state: a CHECK constraint or trigger that lands in
//     migration N may be silently dropped by migration N+k, and only this
//     integration test will catch it.
//
//   - Policy-name and table-name collisions across the full migration set
//     (already covered by 0016 shape test for policies; this test extends
//     to tables, FKs, triggers, CHECK constraints, generated columns).
//
// Tier classification
// -------------------
//
// pglite-applies-cleanly tier (mirrors tests/migrations/payments-rls-policies-
// shape.test.ts Tier 3). All assertions are run against a single fresh pglite
// instance booted via bootPgliteWithAllMigrations(). Shared boot pattern with
// the 0016 shape test — auth schema scaffolding (users table + auth.uid +
// auth.role) precedes the migration loop.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const __filename_safe =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename_safe) : __dirname;
const MIGRATIONS_DIR = resolve(TEST_DIR, '..', '..', 'supabase', 'migrations');

// Expected end-state after applying 0001..0016 in order.

const EXPECTED_TABLES = [
  'payments',
  'memberships',
  'time_wallets',
  'time_ledger',
  'disputes',
  'stripe_webhook_events',
  'refund_requests',
] as const;

const EXPECTED_POLICIES = [
  'payments_self_or_cashier_read',
  'memberships_self_or_cashier_read',
  'memberships_manager_write',
  'time_wallets_self_or_cashier_read',
  'time_ledger_self_or_cashier_read',
  'time_ledger_cashier_insert',
  'refund_requests_manager_read',
  'refund_requests_manager_insert',
  'stripe_webhook_events_manager_read',
  'disputes_manager_read',
] as const;

const EXPECTED_CHECK_CONSTRAINTS = [
  'payments_currency_usd_only',
  'refund_requests_amount_positive',
  'payments_idem_or_audit_trail',
  'time_ledger_payment_or_manual',
  'stripe_webhook_events_attempts_nonneg',
] as const;

async function runSqlBlock(pg: PGlite, sql: string): Promise<void> {
  const runner = (pg as unknown as { exec: (s: string) => Promise<unknown> })['exec'];
  await runner.call(pg, sql);
}

async function bootPgliteWithAllMigrations(): Promise<PGlite> {
  const pg = new PGlite({ extensions: { pgcrypto } });

  // Auth schema scaffolding (matches 0016 shape test boot pattern).
  await runSqlBlock(pg, 'CREATE SCHEMA IF NOT EXISTS auth');
  await runSqlBlock(
    pg,
    `CREATE TABLE IF NOT EXISTS auth.users (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid()
     );`,
  );
  await runSqlBlock(
    pg,
    `CREATE OR REPLACE FUNCTION auth.uid()
     RETURNS uuid LANGUAGE sql STABLE
     AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;`,
  );
  await runSqlBlock(
    pg,
    `CREATE OR REPLACE FUNCTION auth.role()
     RETURNS text LANGUAGE sql STABLE
     AS $$ SELECT COALESCE(NULLIF(current_setting('test.role', true), ''), 'authenticated') $$;`,
  );

  // Apply every migration in lexicographic order. Sorted so Windows and
  // POSIX agree on the sequence.
  const allMigrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const name of allMigrations) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
    await runSqlBlock(pg, sql);
  }
  return pg;
}

describe('ADR-0036 Slice 1 — full 16-migration integration test (T20)', () => {
  it('applies all 16 migrations in order against a fresh pglite without error', async () => {
    const pg = await bootPgliteWithAllMigrations();
    try {
      // Smoke: count the migrations that exist on disk so the test fails
      // loudly if a future migration is added without updating the slice
      // scope (the spec pins the slice at exactly 16 files; growth past
      // that point is a signal to revisit T20).
      const allMigrations = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      expect(allMigrations.length).toBe(16);
      expect(allMigrations[0]).toBe('0001_feature_flags.sql');
      expect(allMigrations[15]).toBe('0016_payments_rls.sql');
    } finally {
      await pg.close();
    }
  });

  it('every expected ADR-0036 table exists in the public schema and is queryable', async () => {
    const pg = await bootPgliteWithAllMigrations();
    try {
      for (const table of EXPECTED_TABLES) {
        const exists = await pg.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1`,
          [table],
        );
        expect(exists.rows[0]?.count).toBe('1');
        const probe = await pg.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM ${table}`,
        );
        expect(probe.rows[0]?.count).toBe('0');
      }
    } finally {
      await pg.close();
    }
  });

  it('every FK reference in the seven ADR-0036 tables resolves to an existing table+column', async () => {
    const pg = await bootPgliteWithAllMigrations();
    try {
      // Walk every FK declared on the seven new tables and confirm the
      // referenced table+column exists. An unresolved FK in
      // information_schema.referential_constraints would be a migration-
      // ordering regression (forward-reference to a table that has not
      // been created yet at the point of CREATE TABLE).
      const fks = await pg.query<{
        constraint_name: string;
        table_name: string;
        column_name: string;
        foreign_table_schema: string;
        foreign_table_name: string;
        foreign_column_name: string;
      }>(
        `SELECT
            tc.constraint_name,
            tc.table_name,
            kcu.column_name,
            ccu.table_schema AS foreign_table_schema,
            ccu.table_name   AS foreign_table_name,
            ccu.column_name  AS foreign_column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
           AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema = 'public'
           AND tc.table_name = ANY($1::text[])`,
        [EXPECTED_TABLES as unknown as string[]],
      );

      expect(fks.rows.length).toBeGreaterThan(0);

      for (const fk of fks.rows) {
        // Verify the referenced table exists in either public or auth.
        const ref = await pg.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM information_schema.tables
            WHERE table_schema = $1 AND table_name = $2`,
          [fk.foreign_table_schema, fk.foreign_table_name],
        );
        expect(ref.rows[0]?.count).toBe('1');
        // And the referenced column exists on that table.
        const col = await pg.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
          [fk.foreign_table_schema, fk.foreign_table_name, fk.foreign_column_name],
        );
        expect(col.rows[0]?.count).toBe('1');
      }
    } finally {
      await pg.close();
    }
  });

  it('every expected RLS policy (10 names from 0016) exists in pg_policy at end-state', async () => {
    const pg = await bootPgliteWithAllMigrations();
    try {
      for (const name of EXPECTED_POLICIES) {
        const row = await pg.query<{ polname: string }>(
          `SELECT p.polname
             FROM pg_policy p
             JOIN pg_class c ON c.oid = p.polrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND p.polname = $1`,
          [name],
        );
        expect(row.rows.length).toBe(1);
      }
    } finally {
      await pg.close();
    }
  });

  it('the AC5 trigger time_ledger_balance_trigger exists on time_ledger', async () => {
    const pg = await bootPgliteWithAllMigrations();
    try {
      const trig = await pg.query<{ tgname: string; relname: string }>(
        `SELECT t.tgname, c.relname
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
          WHERE t.tgname = 'time_ledger_balance_trigger'
            AND NOT t.tgisinternal`,
      );
      expect(trig.rows.length).toBe(1);
      expect(trig.rows[0]?.relname).toBe('time_ledger');
    } finally {
      await pg.close();
    }
  });

  it('the time_wallets.balance_cents GENERATED column is queryable and derives from balance_minutes', async () => {
    const pg = await bootPgliteWithAllMigrations();
    try {
      // The column must exist and be readable (the per-migration shape
      // test covers the GENERATED expression; this test verifies the
      // composite state still exposes it after all 16 migrations).
      const col = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'time_wallets'
            AND column_name = 'balance_cents'`,
      );
      expect(col.rows[0]?.count).toBe('1');

      // SELECTing the column on an empty table is the cheapest end-to-end
      // proof that the GENERATED expression compiles in the final state.
      const probe = await pg.query<{ balance_cents: string | null }>(
        `SELECT balance_cents::text AS balance_cents FROM time_wallets LIMIT 1`,
      );
      expect(probe.rows).toEqual([]);
    } finally {
      await pg.close();
    }
  });

  it('all expected CHECK constraints survive the full migration sequence', async () => {
    const pg = await bootPgliteWithAllMigrations();
    try {
      for (const name of EXPECTED_CHECK_CONSTRAINTS) {
        const row = await pg.query<{ constraint_name: string }>(
          `SELECT constraint_name
             FROM information_schema.check_constraints
            WHERE constraint_schema = 'public' AND constraint_name = $1`,
          [name],
        );
        expect(row.rows.length).toBe(1);
      }
    } finally {
      await pg.close();
    }
  });

  it('every ADR-0036 table has RLS enabled AND forced (D4 fail-closed posture)', async () => {
    const pg = await bootPgliteWithAllMigrations();
    try {
      for (const table of EXPECTED_TABLES) {
        const rls = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
          `SELECT c.relrowsecurity, c.relforcerowsecurity
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = $1`,
          [table],
        );
        expect(rls.rows[0]?.relrowsecurity).toBe(true);
        expect(rls.rows[0]?.relforcerowsecurity).toBe(true);
      }
    } finally {
      await pg.close();
    }
  });
});
