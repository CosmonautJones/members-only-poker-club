// Migration shape test — ADR-0036 / AC10.
//
// Three fidelity tiers (mirrors tests/migrations/refund-requests-shape.test.ts):
//
//   1. Regex tier — lexical assertions: filename, all 10 policy names by
//      name + cmd + predicate text, memberships profile_id immutability
//      trigger (function + CREATE TRIGGER), three load-bearing COMMENTs
//      (refund_requests TABLE, time_ledger_cashier_insert POLICY,
//      memberships.profile_id COLUMN), no DELETE policy anywhere, no
//      forbidden INSERT/UPDATE policies (payments/disputes/stripe_webhook_events
//      have no INSERT or UPDATE policy; time_wallets has no INSERT policy),
//      auth.role_at_least usage (not public.role_at_least).
//
//   2. Cross-migration tier — apply migrations 0001..0016 in sequence
//      against a fresh pglite and assert via pg_policy that no policy name
//      collides across the entire migration set (premortem R4 invariant).
//
//   3. pglite-applies-cleanly tier — verifies the migration applies after
//      0001..0015 against a fresh pglite, that every expected policy exists
//      by name on the right table via SELECT polname FROM pg_policy, that
//      the memberships immutability trigger is present, and that all seven
//      tables are RLS-enabled AND FORCED.
//
// Premortem coupling (.conductor/36/returns/0005-premortem-rls.md):
//   R4 — policy-name collision invariant: cross-migration tier asserts no
//        policy name appears more than once across all 16 migrations.
//   R5 — refund_requests UPDATE-policy absence is load-bearing: regex tier
//        asserts COMMENT ON TABLE refund_requests pins this.
//   R6 — time_ledger_cashier_insert intentional non-tightening: regex tier
//        asserts COMMENT ON POLICY pins the load-bearing reasoning.
//   R9 — memberships profile_id immutability: trigger + function presence
//        asserted by regex + pglite tiers; COMMENT ON COLUMN asserted by
//        regex tier.

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
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, '0016_payments_rls.sql');
const SQL = readFileSync(MIGRATION_PATH, 'utf8');

async function runSqlBlock(pg: PGlite, sql: string): Promise<void> {
  const runner = (pg as unknown as { exec: (s: string) => Promise<unknown> })['exec'];
  await runner.call(pg, sql);
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const SQL_NO_COMMENTS = stripComments(SQL);

// The exact set of 10 policy names this migration ships. LOAD-BEARING — t5
// contract tests grep for these names, and the cross-migration uniqueness
// tier will catch any future collision.
const EXPECTED_POLICIES: { name: string; table: string; cmd: 'SELECT' | 'INSERT' | 'UPDATE' }[] = [
  { name: 'payments_self_or_cashier_read', table: 'payments', cmd: 'SELECT' },
  { name: 'memberships_self_or_cashier_read', table: 'memberships', cmd: 'SELECT' },
  { name: 'memberships_manager_write', table: 'memberships', cmd: 'UPDATE' },
  { name: 'time_wallets_self_or_cashier_read', table: 'time_wallets', cmd: 'SELECT' },
  { name: 'time_ledger_self_or_cashier_read', table: 'time_ledger', cmd: 'SELECT' },
  { name: 'time_ledger_cashier_insert', table: 'time_ledger', cmd: 'INSERT' },
  { name: 'refund_requests_manager_read', table: 'refund_requests', cmd: 'SELECT' },
  { name: 'refund_requests_manager_insert', table: 'refund_requests', cmd: 'INSERT' },
  { name: 'stripe_webhook_events_manager_read', table: 'stripe_webhook_events', cmd: 'SELECT' },
  { name: 'disputes_manager_read', table: 'disputes', cmd: 'SELECT' },
];

// -----------------------------------------------------------------------------
// Tier 1 — Regex / substring assertions (AC10 lexical tier)
// -----------------------------------------------------------------------------

describe('0016_payments_rls migration — regex tier (AC10 lexical assertions)', () => {
  it('filename matches NNNN_<snake_case>.sql convention and the slice-1 specific name', () => {
    const filename = MIGRATION_PATH.split(/[\\/]/).pop() ?? '';
    expect(filename).toMatch(/^0016_payments_rls\.sql$/);
    expect(filename).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('declares all 10 policy names verbatim (load-bearing — t5 contract tests grep for these)', () => {
    for (const { name } of EXPECTED_POLICIES) {
      expect(SQL).toMatch(new RegExp(`CREATE\\s+POLICY\\s+${name}\\b`));
    }
  });

  it('payments_self_or_cashier_read is FOR SELECT with USING (profile_id = auth.uid() OR auth.role_at_least(cashier))', () => {
    const idx = SQL.search(/CREATE\s+POLICY\s+payments_self_or_cashier_read/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(idx, idx + 600);
    expect(block).toMatch(/ON\s+payments\b/i);
    expect(block).toMatch(/FOR\s+SELECT/i);
    expect(block).toMatch(/USING\s*\(/i);
    expect(block).toMatch(/profile_id\s*=\s*auth\.uid\(\)/i);
    expect(block).toMatch(/auth\.role_at_least\(\s*'cashier'\s*\)/i);
  });

  it('memberships_self_or_cashier_read is FOR SELECT with USING (profile_id = auth.uid() OR auth.role_at_least(cashier))', () => {
    const idx = SQL.search(/CREATE\s+POLICY\s+memberships_self_or_cashier_read/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(idx, idx + 600);
    expect(block).toMatch(/ON\s+memberships\b/i);
    expect(block).toMatch(/FOR\s+SELECT/i);
    expect(block).toMatch(/profile_id\s*=\s*auth\.uid\(\)/i);
    expect(block).toMatch(/auth\.role_at_least\(\s*'cashier'\s*\)/i);
  });

  it('memberships_manager_write is FOR UPDATE with USING + WITH CHECK both auth.role_at_least(manager)', () => {
    const idx = SQL.search(/CREATE\s+POLICY\s+memberships_manager_write/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(idx, idx + 800);
    expect(block).toMatch(/ON\s+memberships\b/i);
    expect(block).toMatch(/FOR\s+UPDATE/i);
    expect(block).toMatch(/USING\s*\(/i);
    expect(block).toMatch(/WITH\s+CHECK\s*\(/i);
    const matches = block.match(/auth\.role_at_least\(\s*'manager'\s*\)/gi) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('time_wallets_self_or_cashier_read is FOR SELECT on time_wallets with profile_id/cashier predicate', () => {
    const idx = SQL.search(/CREATE\s+POLICY\s+time_wallets_self_or_cashier_read/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(idx, idx + 600);
    expect(block).toMatch(/ON\s+time_wallets\b/i);
    expect(block).toMatch(/FOR\s+SELECT/i);
    expect(block).toMatch(/profile_id\s*=\s*auth\.uid\(\)/i);
    expect(block).toMatch(/auth\.role_at_least\(\s*'cashier'\s*\)/i);
  });

  it('time_ledger_self_or_cashier_read is FOR SELECT on time_ledger with profile_id/cashier predicate', () => {
    const idx = SQL.search(/CREATE\s+POLICY\s+time_ledger_self_or_cashier_read/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(idx, idx + 600);
    expect(block).toMatch(/ON\s+time_ledger\b/i);
    expect(block).toMatch(/FOR\s+SELECT/i);
    expect(block).toMatch(/profile_id\s*=\s*auth\.uid\(\)/i);
    expect(block).toMatch(/auth\.role_at_least\(\s*'cashier'\s*\)/i);
  });

  it('time_ledger_cashier_insert is FOR INSERT with WITH CHECK auth.role_at_least(cashier)', () => {
    const idx = SQL.search(/CREATE\s+POLICY\s+time_ledger_cashier_insert/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(idx, idx + 600);
    expect(block).toMatch(/ON\s+time_ledger\b/i);
    expect(block).toMatch(/FOR\s+INSERT/i);
    expect(block).toMatch(/WITH\s+CHECK\s*\(/i);
    expect(block).toMatch(/auth\.role_at_least\(\s*'cashier'\s*\)/i);
  });

  it('refund_requests_manager_read is FOR SELECT with USING auth.role_at_least(manager)', () => {
    const idx = SQL.search(/CREATE\s+POLICY\s+refund_requests_manager_read/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(idx, idx + 500);
    expect(block).toMatch(/ON\s+refund_requests\b/i);
    expect(block).toMatch(/FOR\s+SELECT/i);
    expect(block).toMatch(/auth\.role_at_least\(\s*'manager'\s*\)/i);
  });

  it('refund_requests_manager_insert is FOR INSERT with WITH CHECK auth.role_at_least(manager)', () => {
    const idx = SQL.search(/CREATE\s+POLICY\s+refund_requests_manager_insert/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(idx, idx + 500);
    expect(block).toMatch(/ON\s+refund_requests\b/i);
    expect(block).toMatch(/FOR\s+INSERT/i);
    expect(block).toMatch(/WITH\s+CHECK\s*\(/i);
    expect(block).toMatch(/auth\.role_at_least\(\s*'manager'\s*\)/i);
  });

  it('stripe_webhook_events_manager_read is FOR SELECT with USING auth.role_at_least(manager)', () => {
    const idx = SQL.search(/CREATE\s+POLICY\s+stripe_webhook_events_manager_read/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(idx, idx + 500);
    expect(block).toMatch(/ON\s+stripe_webhook_events\b/i);
    expect(block).toMatch(/FOR\s+SELECT/i);
    expect(block).toMatch(/auth\.role_at_least\(\s*'manager'\s*\)/i);
  });

  it('disputes_manager_read is FOR SELECT with USING auth.role_at_least(manager)', () => {
    const idx = SQL.search(/CREATE\s+POLICY\s+disputes_manager_read/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(idx, idx + 500);
    expect(block).toMatch(/ON\s+disputes\b/i);
    expect(block).toMatch(/FOR\s+SELECT/i);
    expect(block).toMatch(/auth\.role_at_least\(\s*'manager'\s*\)/i);
  });

  it('uses auth.role_at_least (not public.role_at_least) consistently (synthesis D1)', () => {
    // The hosted-prod drift (`public.role_at_least`) is documented in user
    // memory as a known issue; in-repo migrations follow the established
    // `auth.role_at_least` convention from 0005 and 0006. Strip comments so
    // the documentation paragraph mentioning the drift doesn't trip this.
    expect(SQL_NO_COMMENTS).not.toMatch(/\bpublic\.role_at_least\b/);
    // At least one auth.role_at_least call must exist.
    expect(SQL_NO_COMMENTS).toMatch(/\bauth\.role_at_least\b/);
  });

  it('does NOT declare any FOR DELETE policy in this migration (append-only invariant)', () => {
    // Strip comments so the INVARIANTS block mentioning forbidden patterns
    // does not trip the test.
    expect(SQL_NO_COMMENTS).not.toMatch(/FOR\s+DELETE/i);
  });

  it('does NOT declare any FOR INSERT or FOR UPDATE policy on payments / disputes / stripe_webhook_events', () => {
    // These three tables are service-role-write-only. Their absence-of-INSERT/
    // UPDATE-policy is the load-bearing enforcement.
    expect(SQL_NO_COMMENTS).not.toMatch(/CREATE\s+POLICY\s+payments_[a-z_]+_(?:insert|update)\b/i);
    expect(SQL_NO_COMMENTS).not.toMatch(/CREATE\s+POLICY\s+disputes_[a-z_]+_(?:insert|update)\b/i);
    expect(SQL_NO_COMMENTS).not.toMatch(
      /CREATE\s+POLICY\s+stripe_webhook_events_[a-z_]+_(?:insert|update)\b/i,
    );
  });

  it('does NOT declare any FOR INSERT policy on time_wallets (rows written exclusively by trigger)', () => {
    expect(SQL_NO_COMMENTS).not.toMatch(/CREATE\s+POLICY\s+time_wallets_[a-z_]+_insert\b/i);
  });

  it('does NOT declare ENABLE/FORCE ROW LEVEL SECURITY (those land in 0008..0015 per D4)', () => {
    expect(SQL_NO_COMMENTS).not.toMatch(/\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i);
    expect(SQL_NO_COMMENTS).not.toMatch(/\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b/i);
  });

  it('declares memberships profile_id immutability function + trigger (premortem R9)', () => {
    expect(SQL).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.memberships_protect_profile_id_immutable/i,
    );
    expect(SQL).toMatch(/CREATE\s+TRIGGER\s+memberships_profile_id_immutable_trigger/i);
    expect(SQL).toMatch(/BEFORE\s+UPDATE\s+ON\s+memberships/i);
    // The function body must raise SQLSTATE 42501 on profile_id mutation.
    expect(SQL).toMatch(/RAISE\s+EXCEPTION/i);
    expect(SQL).toMatch(/'42501'/);
    expect(SQL).toMatch(/OLD\.profile_id\s+IS\s+DISTINCT\s+FROM\s+NEW\.profile_id/i);
  });

  it('contains COMMENT ON POLICY time_ledger_cashier_insert documenting non-tightening (premortem R6)', () => {
    expect(SQL).toMatch(
      /COMMENT\s+ON\s+POLICY\s+time_ledger_cashier_insert\s+ON\s+time_ledger\s+IS/i,
    );
    const idx = SQL.search(
      /COMMENT\s+ON\s+POLICY\s+time_ledger_cashier_insert\s+ON\s+time_ledger\s+IS/i,
    );
    const block = SQL.slice(idx, idx + 1200);
    expect(block).toMatch(/lib\/payments\/authority\.ts/i);
    expect(block).toMatch(/DO\s+NOT\s+tighten/i);
    expect(block).toMatch(/service-role\s+webhook/i);
  });

  it('contains COMMENT ON TABLE refund_requests documenting no-UPDATE-policy as load-bearing (premortem R5)', () => {
    expect(SQL).toMatch(/COMMENT\s+ON\s+TABLE\s+refund_requests\s+IS/i);
    const idx = SQL.search(/COMMENT\s+ON\s+TABLE\s+refund_requests\s+IS/i);
    const block = SQL.slice(idx, idx + 1500);
    expect(block).toMatch(/lib\/payments\/authority\.ts/i);
    // Must explicitly call out the no-UPDATE-policy intent.
    expect(block).toMatch(/do\s+not\s+add\s+an\s+UPDATE\s+policy/i);
  });

  it('contains COMMENT ON COLUMN memberships.profile_id documenting immutability (premortem R9)', () => {
    expect(SQL).toMatch(/COMMENT\s+ON\s+COLUMN\s+memberships\.profile_id\s+IS/i);
    const idx = SQL.search(/COMMENT\s+ON\s+COLUMN\s+memberships\.profile_id\s+IS/i);
    const block = SQL.slice(idx, idx + 800);
    expect(block).toMatch(/Immutable\s+post-INSERT/i);
    expect(block).toMatch(/memberships_profile_id_immutable_trigger/i);
  });

  it('contains slice-2 TODO marker for stripe_webhook_events.payload audit-on-read (premortem R10)', () => {
    expect(SQL).toMatch(/TODO\(ADR-0036\s+Slice\s+2\s+follow-up\)/i);
    expect(SQL).toMatch(/stripe_webhook_events\.payload/i);
  });
});

// -----------------------------------------------------------------------------
// Tier 2 — pglite-applies-cleanly tier — apply 0001..0016 against fresh pglite,
// verify every expected policy exists by name on the right table and command,
// verify RLS is FORCED on every one of the 7 new tables, and verify the
// memberships immutability trigger is present.
// -----------------------------------------------------------------------------

async function bootPgliteWithAllMigrations(): Promise<PGlite> {
  const pg = new PGlite({ extensions: { pgcrypto } });
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

  // Apply all 16 migrations in sequence. Sorted to guarantee deterministic
  // order even if readdirSync returns them differently on Windows vs POSIX.
  const allMigrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const name of allMigrations) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
    await runSqlBlock(pg, sql);
  }
  return pg;
}

describe('0016_payments_rls migration — pglite-applies-cleanly tier', () => {
  it('applies cleanly after 0001..0015 against a fresh pglite instance', async () => {
    const pg = await bootPgliteWithAllMigrations();
    try {
      // Smoke: every one of the 7 target tables exists and is empty.
      for (const table of [
        'payments',
        'memberships',
        'time_wallets',
        'time_ledger',
        'refund_requests',
        'stripe_webhook_events',
        'disputes',
      ]) {
        const probe = await pg.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM ${table}`,
        );
        expect(probe.rows[0]?.count).toBe('0');
      }
    } finally {
      await pg.close();
    }
  });

  it('every one of the 7 new tables has RLS enabled AND forced (premortem R1)', async () => {
    const pg = await bootPgliteWithAllMigrations();
    try {
      for (const table of [
        'payments',
        'memberships',
        'time_wallets',
        'time_ledger',
        'refund_requests',
        'stripe_webhook_events',
        'disputes',
      ]) {
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

  it('every expected policy exists by name on the right table with the right command (pg_policy introspection)', async () => {
    const pg = await bootPgliteWithAllMigrations();
    try {
      // pg_policy.polcmd: r=SELECT, a=INSERT, w=UPDATE, d=DELETE, *=ALL.
      const cmdMap: Record<'SELECT' | 'INSERT' | 'UPDATE', string> = {
        SELECT: 'r',
        INSERT: 'a',
        UPDATE: 'w',
      };
      for (const expected of EXPECTED_POLICIES) {
        const row = await pg.query<{ polname: string; relname: string; polcmd: string }>(
          `SELECT p.polname, c.relname, p.polcmd::text
             FROM pg_policy p
             JOIN pg_class c ON c.oid = p.polrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND p.polname = $1`,
          [expected.name],
        );
        expect(row.rows.length).toBe(1);
        expect(row.rows[0]?.relname).toBe(expected.table);
        expect(row.rows[0]?.polcmd).toBe(cmdMap[expected.cmd]);
      }
    } finally {
      await pg.close();
    }
  });

  it('memberships_profile_id_immutable_trigger exists as a BEFORE UPDATE trigger on memberships (premortem R9)', async () => {
    const pg = await bootPgliteWithAllMigrations();
    try {
      const trig = await pg.query<{ tgname: string; relname: string; tgtype: number }>(
        `SELECT t.tgname, c.relname, t.tgtype
           FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
           WHERE t.tgname = 'memberships_profile_id_immutable_trigger'
             AND NOT t.tgisinternal`,
      );
      expect(trig.rows.length).toBe(1);
      expect(trig.rows[0]?.relname).toBe('memberships');
      // tgtype bits: 1=ROW, 2=BEFORE, 16=UPDATE. (1 | 2 | 16) = 19.
      // Some pg_trigger flavors may set additional bits — only assert BEFORE
      // and UPDATE are set (bits 2 and 16).
      const tgtype = trig.rows[0]!.tgtype;
      expect((tgtype & 2) !== 0).toBe(true); // BEFORE
      expect((tgtype & 16) !== 0).toBe(true); // UPDATE
    } finally {
      await pg.close();
    }
  });

  it('memberships UPDATE that rewrites profile_id raises SQLSTATE 42501 (premortem R9 enforcement)', async () => {
    const pg = await bootPgliteWithAllMigrations();
    try {
      // Seed two profiles + one membership row.
      const profileA = '00000000-0000-0000-0000-00000000a000';
      const profileB = '00000000-0000-0000-0000-00000000b000';
      await runSqlBlock(
        pg,
        `INSERT INTO auth.users (id) VALUES ('${profileA}'), ('${profileB}');
         INSERT INTO profiles (id, full_name, dob, email, role)
         VALUES
           ('${profileA}', 'Member A', '1990-01-01', 'a@example.test', 'member'),
           ('${profileB}', 'Member B', '1990-01-01', 'b@example.test', 'member');
         INSERT INTO memberships (profile_id, stripe_customer_id, status)
         VALUES ('${profileA}', 'cus_test_a', 'active');`,
      );
      // Sanity: in-place UPDATE that does NOT touch profile_id succeeds.
      await runSqlBlock(
        pg,
        `UPDATE memberships SET status = 'past_due' WHERE profile_id = '${profileA}';`,
      );
      // Now attempt to rewrite profile_id — must raise 42501.
      let caught: (Error & { code?: string }) | undefined;
      try {
        await runSqlBlock(
          pg,
          `UPDATE memberships SET profile_id = '${profileB}' WHERE profile_id = '${profileA}';`,
        );
      } catch (err) {
        caught = err as Error & { code?: string };
      }
      expect(caught).toBeDefined();
      expect(caught!.code).toBe('42501');
    } finally {
      await pg.close();
    }
  });

  it('cross-migration policy-name uniqueness across all 16 migrations (premortem R4)', async () => {
    const pg = await bootPgliteWithAllMigrations();
    try {
      // pg_policy collision check — every policy name appears exactly once
      // (a name can be reused across different tables in Postgres, but the
      // repo invariant per ADR-0036 §RLS premortem R4 is that names are
      // globally unique to keep grep-discoverability across the migration
      // set).
      const dupes = await pg.query<{ polname: string; cnt: string }>(
        `SELECT polname, count(*)::text AS cnt
           FROM pg_policy
           GROUP BY polname
          HAVING count(*) > 1`,
      );
      expect(dupes.rows).toEqual([]);
    } finally {
      await pg.close();
    }
  });

  it('exactly 10 new policies land across the 7 target tables (no extra, no missing)', async () => {
    const pg = await bootPgliteWithAllMigrations();
    try {
      const targetTables = [
        'payments',
        'memberships',
        'time_wallets',
        'time_ledger',
        'refund_requests',
        'stripe_webhook_events',
        'disputes',
      ];
      const policies = await pg.query<{ polname: string; relname: string }>(
        `SELECT p.polname, c.relname
           FROM pg_policy p
           JOIN pg_class c ON c.oid = p.polrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
          ORDER BY c.relname, p.polname`,
        [targetTables],
      );
      const names = policies.rows.map((r) => r.polname).sort();
      const expectedNames = EXPECTED_POLICIES.map((p) => p.name).sort();
      expect(names).toEqual(expectedNames);
    } finally {
      await pg.close();
    }
  });
});
