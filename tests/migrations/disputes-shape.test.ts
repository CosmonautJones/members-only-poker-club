// Migration shape test — ADR-0036 / AC6.
//
// Three fidelity tiers (mirrors tests/migrations/payments-shape.test.ts):
//
//   1. Regex/substring tier — lexical assertions: filename, column names,
//      stripe_dispute_id text PRIMARY KEY, payment_intent_id NOT NULL,
//      profile_id NULLABLE FK to profiles(id) ON DELETE NO ACTION,
//      ENABLE+FORCE RLS, COMMENT ON TABLE pinning ADR-0027 deferral.
//
//   2. AST tier — pg-query-emscripten parses the migration SQL. Walks the
//      parse tree to assert column count + order, stripe_dispute_id has
//      CONSTR_PRIMARY (text PK), profile_id has CONSTR_FOREIGN with NO
//      ACTION on delete and is NULLABLE (no CONSTR_NOTNULL).
//
//   3. pglite-applies-cleanly tier — apply migrations 0001..0009 plus
//      0013_disputes.sql against a fresh pglite instance and assert success.
//
// Premortem coupling (.conductor/36/returns/0004-premortem-schema.md):
//   R8 — RLS-off window: ENABLE+FORCE RLS at end of THIS migration so
//        default-deny is in place before 0016 lands policies.
//   R9 — explicit `ON DELETE NO ACTION` on REFERENCES profiles(id).

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import PgQueryModule from 'pg-query-emscripten';

const __filename_safe =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename_safe) : __dirname;
const MIGRATIONS_DIR = resolve(TEST_DIR, '..', '..', 'supabase', 'migrations');
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, '0013_disputes.sql');
const SQL = readFileSync(MIGRATION_PATH, 'utf8');

async function runSqlBlock(pg: PGlite, sql: string): Promise<void> {
  const runner = (pg as unknown as { exec: (s: string) => Promise<unknown> })['exec'];
  await runner.call(pg, sql);
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const SQL_NO_COMMENTS = stripComments(SQL);

// -----------------------------------------------------------------------------
// Tier 1 — Regex / substring assertions (AC6 lexical tier)
// -----------------------------------------------------------------------------

describe('disputes migration — regex tier (AC6 lexical assertions)', () => {
  it('filename matches NNNN_<snake_case>.sql convention and the slice-1 specific name', () => {
    const filename = MIGRATION_PATH.split(/[\\/]/).pop() ?? '';
    expect(filename).toMatch(/^0013_disputes\.sql$/);
    expect(filename).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('creates disputes table with all 9 v1 column names', () => {
    expect(SQL).toMatch(/CREATE\s+TABLE\s+disputes/i);
    for (const col of [
      'stripe_dispute_id',
      'payment_intent_id',
      'profile_id',
      'amount_cents',
      'status',
      'reason',
      'outcome',
      'created_at',
      'updated_at',
    ]) {
      expect(SQL).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('stripe_dispute_id is text PRIMARY KEY (ADR-0036 §Data model)', () => {
    expect(SQL).toMatch(/stripe_dispute_id[^,]*text[^,]*PRIMARY\s+KEY/i);
  });

  it('payment_intent_id is text NOT NULL', () => {
    expect(SQL).toMatch(/payment_intent_id[^,]*text[^,]*NOT\s+NULL/i);
  });

  it('profile_id references profiles(id) with explicit ON DELETE NO ACTION (premortem R9) and is NULLABLE', () => {
    // disputes.profile_id is nullable per ADR — best-effort join via Stripe
    // customer; some disputes may arrive before/without a resolved member.
    // The regex pins the FK + NO ACTION clause; the nullability is asserted
    // by the AST tier below (absence of NOT NULL constraint node).
    expect(SQL).toMatch(
      /profile_id[^,]*uuid[^,]*REFERENCES\s+profiles\s*\(\s*id\s*\)\s+ON\s+DELETE\s+NO\s+ACTION/i,
    );
  });

  it('does NOT declare profile_id NOT NULL (nullable best-effort join per ADR)', () => {
    // ADR §Data model: disputes.profile_id is intentionally nullable.
    expect(SQL_NO_COMMENTS).not.toMatch(/profile_id[^,]*uuid[^,]*NOT\s+NULL/i);
  });

  it('amount_cents is bigint NOT NULL', () => {
    expect(SQL).toMatch(/amount_cents[^,]*bigint[^,]*NOT\s+NULL/i);
  });

  it('status is text NOT NULL', () => {
    expect(SQL).toMatch(/\bstatus\s+text[^,]*NOT\s+NULL/i);
  });

  it('created_at and updated_at are timestamptz NOT NULL DEFAULT now()', () => {
    expect(SQL).toMatch(/created_at[^,]*timestamptz[^,]*NOT\s+NULL[^,]*DEFAULT\s+now\(\)/i);
    expect(SQL).toMatch(/updated_at[^,]*timestamptz[^,]*NOT\s+NULL[^,]*DEFAULT\s+now\(\)/i);
  });

  it('enables AND forces row-level security on disputes (premortem R8 / synthesis D4)', () => {
    expect(SQL).toMatch(/ALTER\s+TABLE\s+disputes\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(SQL).toMatch(/ALTER\s+TABLE\s+disputes\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('does NOT declare any CREATE POLICY in this migration (policies land in 0016)', () => {
    expect(SQL_NO_COMMENTS).not.toMatch(/CREATE\s+POLICY\s+/i);
  });

  it('contains NO ON DELETE CASCADE or ON DELETE SET NULL', () => {
    expect(SQL_NO_COMMENTS).not.toMatch(/ON\s+DELETE\s+CASCADE/i);
    expect(SQL_NO_COMMENTS).not.toMatch(/ON\s+DELETE\s+SET\s+NULL/i);
  });

  it('contains COMMENT ON TABLE disputes documenting ADR-0036 ownership and ADR-0027 deferral', () => {
    expect(SQL).toMatch(/COMMENT\s+ON\s+TABLE\s+disputes\s+IS/i);
    const idx = SQL.search(/COMMENT\s+ON\s+TABLE\s+disputes\s+IS/i);
    const block = SQL.slice(idx, idx + 1200);
    expect(block).toMatch(/ADR-0036/);
    expect(block).toMatch(/ADR-0027/);
  });
});

// -----------------------------------------------------------------------------
// Tier 2 — AST parse-tree assertions (AC6 parser-fidelity tier)
// -----------------------------------------------------------------------------

interface PgQueryStmt {
  RawStmt?: { stmt?: Record<string, unknown> };
  [key: string]: unknown;
}
interface PgQueryParseTree {
  version?: number;
  stmts?: PgQueryStmt[];
}

let parseTree: PgQueryParseTree;

beforeAll(async () => {
  // eslint-disable-next-line new-cap
  const pgQuery = await new PgQueryModule();
  const result = pgQuery.parse(SQL);
  if (result.error) {
    throw new Error(
      `pg-query-emscripten failed to parse 0013_disputes.sql: ${result.error.message}`,
    );
  }
  parseTree = result.parse_tree as PgQueryParseTree;
});

function collectNodes<T = unknown>(root: unknown, key: string): T[] {
  const out: T[] = [];
  const seen = new WeakSet<object>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      out.push((node as Record<string, T>)[key] as T);
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else {
      for (const value of Object.values(node as Record<string, unknown>)) walk(value);
    }
  };
  walk(root);
  return out;
}

function findCreateTable(relname: string): Record<string, unknown> | undefined {
  const tables = collectNodes<Record<string, unknown>>(parseTree, 'CreateStmt');
  return tables.find((t) => {
    const rel = t.relation as Record<string, unknown> | undefined;
    return rel?.relname === relname;
  });
}

function listColumns(table: Record<string, unknown>): Record<string, unknown>[] {
  const tableElts = (table.tableElts as unknown[]) ?? [];
  return tableElts
    .map((e) => (e as Record<string, unknown>).ColumnDef as Record<string, unknown> | undefined)
    .filter((c): c is Record<string, unknown> => c !== undefined);
}

describe('disputes migration — AST tier (AC6 parser-fidelity assertions)', () => {
  it('parses without error and yields a non-empty stmts array', () => {
    expect(parseTree).toBeDefined();
    expect(Array.isArray(parseTree.stmts)).toBe(true);
    expect((parseTree.stmts ?? []).length).toBeGreaterThan(0);
  });

  it('CreateStmt for disputes has all 9 columns in spec order', () => {
    const table = findCreateTable('disputes');
    expect(table).toBeDefined();
    const columns = listColumns(table!);
    const names = columns.map((c) => c.colname).filter((n): n is string => typeof n === 'string');
    expect(names).toEqual([
      'stripe_dispute_id',
      'payment_intent_id',
      'profile_id',
      'amount_cents',
      'status',
      'reason',
      'outcome',
      'created_at',
      'updated_at',
    ]);
  });

  it('stripe_dispute_id column has CONSTR_PRIMARY (text PK)', () => {
    const table = findCreateTable('disputes');
    const columns = listColumns(table!);
    const pkCol = columns.find((c) => c.colname === 'stripe_dispute_id');
    expect(pkCol).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(pkCol, 'Constraint');
    const hasPrimary = constraints.some(
      (c) => c.contype === 'CONSTR_PRIMARY' || c.contype === 5 || c.contype === 6,
    );
    expect(hasPrimary).toBe(true);
  });

  it('profile_id has FK to profiles with NO ACTION on delete and IS NULLABLE', () => {
    const table = findCreateTable('disputes');
    const columns = listColumns(table!);
    const profileIdCol = columns.find((c) => c.colname === 'profile_id');
    expect(profileIdCol).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(profileIdCol, 'Constraint');

    const fkConstraint = constraints.find((c) => c.contype === 'CONSTR_FOREIGN' || c.contype === 8);
    expect(fkConstraint).toBeDefined();
    const pktable = fkConstraint!.pktable as Record<string, unknown> | undefined;
    expect(pktable?.relname).toBe('profiles');

    const delAction = fkConstraint!.fk_del_action;
    expect(delAction).not.toBe('c');
    expect(delAction).not.toBe('n');
    expect(delAction).not.toBe('CASCADE');
    expect(delAction).not.toBe('SET NULL');
    const acceptable: (string | undefined)[] = ['a', 'NO ACTION', '', undefined];
    expect(acceptable).toContain(delAction as string | undefined);

    // Nullable: NO CONSTR_NOTNULL on profile_id.
    const hasNotNull = constraints.some((c) => c.contype === 'CONSTR_NOTNULL' || c.contype === 1);
    expect(hasNotNull).toBe(false);
  });

  it('payment_intent_id, amount_cents, status are NOT NULL', () => {
    const table = findCreateTable('disputes');
    const columns = listColumns(table!);
    for (const colName of ['payment_intent_id', 'amount_cents', 'status']) {
      const col = columns.find((c) => c.colname === colName);
      expect(col).toBeDefined();
      const constraints = collectNodes<Record<string, unknown>>(col, 'Constraint');
      const hasNotNull = constraints.some((c) => c.contype === 'CONSTR_NOTNULL' || c.contype === 1);
      expect(hasNotNull).toBe(true);
    }
  });

  it('AlterTable ENABLE + FORCE row-level security on disputes (premortem R8)', () => {
    const alters = collectNodes<Record<string, unknown>>(parseTree, 'AlterTableStmt');
    const tableAlters = alters.filter((a) => {
      const rel = a.relation as Record<string, unknown> | undefined;
      return rel?.relname === 'disputes';
    });
    expect(tableAlters.length).toBeGreaterThanOrEqual(2);
    const dump = JSON.stringify(tableAlters);
    expect(dump).toMatch(/AT_EnableRowSecurity|EnableRowSecurity|ENABLE.*ROW/i);
    expect(dump).toMatch(/AT_ForceRowSecurity|ForceRowSecurity|FORCE.*ROW/i);
  });

  it('NO CreatePolicyStmt in this migration (policies live in 0016_payments_rls.sql)', () => {
    const policies = collectNodes<Record<string, unknown>>(parseTree, 'CreatePolicyStmt');
    expect(policies).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// Tier 3 — pglite-applies-cleanly tier
// -----------------------------------------------------------------------------

describe('disputes migration — pglite-applies-cleanly tier', () => {
  it('applies cleanly after 0001..0012 against a fresh pglite instance', async () => {
    const pg = new PGlite({ extensions: { pgcrypto } });
    try {
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

      // Apply prior migrations IF they exist (t2 ships 0010..0012; this test
      // is independent of t2 ordering for the disputes table itself —
      // disputes has no FK to time_wallets / time_ledger, so we can apply
      // disputes immediately after 0009_memberships.sql in a t2-not-yet-shipped
      // environment).
      const required = [
        '0001_feature_flags.sql',
        '0002_profiles_and_roles.sql',
        '0003_audit_log.sql',
        '0004_privacy_soft_delete.sql',
        '0005_privacy_requests.sql',
        '0006_feature_flags_rls.sql',
        '0007_clubs_and_display_tz.sql',
        '0008_payments.sql',
        '0009_memberships.sql',
      ];
      for (const name of required) {
        const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
        await runSqlBlock(pg, sql);
      }
      // Apply t2 migrations only if they exist (so this shape test can run
      // in either ordering — t2-before-t3 or t3-before-t2 — since neither
      // references the other's tables).
      for (const name of [
        '0010_time_wallets.sql',
        '0011_time_ledger.sql',
        '0012_time_ledger_balance_trigger.sql',
      ]) {
        try {
          const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
          await runSqlBlock(pg, sql);
        } catch {
          // Not yet shipped — skip; disputes does not depend on these.
        }
      }
      // Apply the migration under test.
      await runSqlBlock(pg, readFileSync(MIGRATION_PATH, 'utf8'));

      // Smoke: disputes table exists.
      const probe = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM disputes`,
      );
      expect(probe.rows[0]?.count).toBe('0');

      // Smoke: information_schema confirms RLS is forced.
      const rls = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
        SELECT c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'disputes'
      `);
      expect(rls.rows[0]?.relrowsecurity).toBe(true);
      expect(rls.rows[0]?.relforcerowsecurity).toBe(true);
    } finally {
      await pg.close();
    }
  });
});
