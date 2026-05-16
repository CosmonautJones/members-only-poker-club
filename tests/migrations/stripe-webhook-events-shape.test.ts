// Migration shape test — ADR-0036 / AC7.
//
// Three fidelity tiers (mirrors tests/migrations/payments-shape.test.ts):
//
//   1. Regex/substring tier — lexical assertions: filename, all 9 columns
//      including the premortem-R7 `attempts` column, three indexes
//      (received_idx DESC, unprocessed_idx partial, stuck_idx partial),
//      attempts CHECK >= 0, ENABLE+FORCE RLS, COMMENT ON TABLE.
//
//   2. AST tier — pg-query-emscripten parses the migration SQL. Walks the
//      parse tree to assert: event_id is CONSTR_PRIMARY (text PK), payload
//      is jsonb NOT NULL, attempts is integer NOT NULL DEFAULT 0,
//      three IndexStmt nodes including two partial indexes.
//
//   3. pglite-applies-cleanly tier — apply migrations 0001..0009 plus
//      0014_stripe_webhook_events.sql against a fresh pglite instance and
//      assert success.
//
// Premortem coupling (.conductor/36/returns/0004-premortem-schema.md):
//   R7 — stripe_webhook_events partial-write invisibility: attempts column
//        + stuck_idx partial index expose the "crashed during processing"
//        cohort distinct from "just arrived, hasn't processed yet".
//   R8 — RLS-off window: ENABLE+FORCE RLS at end of THIS migration so
//        default-deny is in place before 0016 lands policies.

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
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, '0014_stripe_webhook_events.sql');
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
// Tier 1 — Regex / substring assertions (AC7 lexical tier)
// -----------------------------------------------------------------------------

describe('stripe_webhook_events migration — regex tier (AC7 lexical assertions)', () => {
  it('filename matches NNNN_<snake_case>.sql convention and the slice-1 specific name', () => {
    const filename = MIGRATION_PATH.split(/[\\/]/).pop() ?? '';
    expect(filename).toMatch(/^0014_stripe_webhook_events\.sql$/);
    expect(filename).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('creates stripe_webhook_events table with all 9 v1 column names (including premortem-R7 attempts)', () => {
    expect(SQL).toMatch(/CREATE\s+TABLE\s+stripe_webhook_events/i);
    for (const col of [
      'event_id',
      'event_type',
      'livemode',
      'payload',
      'received_at',
      'processed_at',
      'processing_ms',
      'error',
      'attempts',
    ]) {
      expect(SQL).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('event_id is text PRIMARY KEY (Stripe evt_*; idempotency anchor per ADR-0005)', () => {
    expect(SQL).toMatch(/event_id[^,]*text[^,]*PRIMARY\s+KEY/i);
  });

  it('payload is jsonb NOT NULL', () => {
    expect(SQL).toMatch(/payload[^,]*jsonb[^,]*NOT\s+NULL/i);
  });

  it('livemode is boolean NOT NULL', () => {
    expect(SQL).toMatch(/livemode[^,]*boolean[^,]*NOT\s+NULL/i);
  });

  it('received_at is timestamptz NOT NULL DEFAULT now()', () => {
    expect(SQL).toMatch(/received_at[^,]*timestamptz[^,]*NOT\s+NULL[^,]*DEFAULT\s+now\(\)/i);
  });

  it('attempts is integer NOT NULL DEFAULT 0 (premortem R7)', () => {
    expect(SQL).toMatch(/attempts[^,]*integer[^,]*NOT\s+NULL[^,]*DEFAULT\s+0/i);
  });

  it('declares attempts non-negative CHECK constraint (premortem R7)', () => {
    expect(SQL).toMatch(
      /CONSTRAINT\s+stripe_webhook_events_attempts_nonneg\s+CHECK\s*\(\s*attempts\s*>=\s*0\s*\)/i,
    );
  });

  it('declares stripe_webhook_events_received_idx on (received_at DESC)', () => {
    expect(SQL).toMatch(/CREATE\s+INDEX\s+stripe_webhook_events_received_idx/i);
    expect(SQL).toMatch(
      /stripe_webhook_events_received_idx\s+ON\s+stripe_webhook_events\s*\(\s*received_at\s+DESC\s*\)/i,
    );
  });

  it('declares stripe_webhook_events_unprocessed_idx partial WHERE processed_at IS NULL', () => {
    expect(SQL).toMatch(/CREATE\s+INDEX\s+stripe_webhook_events_unprocessed_idx/i);
    expect(SQL).toMatch(
      /stripe_webhook_events_unprocessed_idx\s+ON\s+stripe_webhook_events\s*\(\s*received_at\s*\)\s+WHERE\s+processed_at\s+IS\s+NULL/i,
    );
  });

  it('declares stripe_webhook_events_stuck_idx partial WHERE processed_at IS NULL AND attempts > 0 (premortem R7)', () => {
    // R7: the stuck-idx cohort is "crashed mid-processing" (attempts > 0
    // but never marked done). Distinct from the "just arrived" cohort
    // captured by unprocessed_idx (attempts = 0 is normal startup state).
    expect(SQL).toMatch(/CREATE\s+INDEX\s+stripe_webhook_events_stuck_idx/i);
    expect(SQL).toMatch(
      /stripe_webhook_events_stuck_idx\s+ON\s+stripe_webhook_events\s*\(\s*received_at\s*\)\s+WHERE\s+processed_at\s+IS\s+NULL\s+AND\s+attempts\s*>\s*0/i,
    );
  });

  it('enables AND forces row-level security on stripe_webhook_events (premortem R8 / synthesis D4)', () => {
    expect(SQL).toMatch(/ALTER\s+TABLE\s+stripe_webhook_events\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(SQL).toMatch(/ALTER\s+TABLE\s+stripe_webhook_events\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('does NOT declare any CREATE POLICY in this migration (policies land in 0016)', () => {
    expect(SQL_NO_COMMENTS).not.toMatch(/CREATE\s+POLICY\s+/i);
  });

  it('contains COMMENT ON TABLE stripe_webhook_events documenting ADR-0005 idempotency anchor', () => {
    expect(SQL).toMatch(/COMMENT\s+ON\s+TABLE\s+stripe_webhook_events\s+IS/i);
    const idx = SQL.search(/COMMENT\s+ON\s+TABLE\s+stripe_webhook_events\s+IS/i);
    const block = SQL.slice(idx, idx + 1500);
    expect(block).toMatch(/ADR-0005/);
    expect(block).toMatch(/ADR-0036/);
  });

  it('contains the migration-review acknowledgement comment for blocking CREATE INDEX', () => {
    expect(SQL).toMatch(/migration-review:\s+blocking-index-approved/);
  });
});

// -----------------------------------------------------------------------------
// Tier 2 — AST parse-tree assertions (AC7 parser-fidelity tier)
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
      `pg-query-emscripten failed to parse 0014_stripe_webhook_events.sql: ${result.error.message}`,
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

function subtreeContains(node: unknown, needle: string): boolean {
  return JSON.stringify(node).includes(needle);
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

describe('stripe_webhook_events migration — AST tier (AC7 parser-fidelity assertions)', () => {
  it('parses without error and yields a non-empty stmts array', () => {
    expect(parseTree).toBeDefined();
    expect(Array.isArray(parseTree.stmts)).toBe(true);
    expect((parseTree.stmts ?? []).length).toBeGreaterThan(0);
  });

  it('CreateStmt for stripe_webhook_events has all 9 columns in spec order', () => {
    const table = findCreateTable('stripe_webhook_events');
    expect(table).toBeDefined();
    const columns = listColumns(table!);
    const names = columns.map((c) => c.colname).filter((n): n is string => typeof n === 'string');
    expect(names).toEqual([
      'event_id',
      'event_type',
      'livemode',
      'payload',
      'received_at',
      'processed_at',
      'processing_ms',
      'error',
      'attempts',
    ]);
  });

  it('event_id column has CONSTR_PRIMARY (text PK)', () => {
    const table = findCreateTable('stripe_webhook_events');
    const columns = listColumns(table!);
    const pkCol = columns.find((c) => c.colname === 'event_id');
    expect(pkCol).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(pkCol, 'Constraint');
    const hasPrimary = constraints.some(
      (c) => c.contype === 'CONSTR_PRIMARY' || c.contype === 5 || c.contype === 6,
    );
    expect(hasPrimary).toBe(true);
  });

  it('payload is NOT NULL', () => {
    const table = findCreateTable('stripe_webhook_events');
    const columns = listColumns(table!);
    const col = columns.find((c) => c.colname === 'payload');
    expect(col).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(col, 'Constraint');
    const hasNotNull = constraints.some((c) => c.contype === 'CONSTR_NOTNULL' || c.contype === 1);
    expect(hasNotNull).toBe(true);
  });

  it('attempts has CONSTR_NOTNULL and CONSTR_DEFAULT (premortem R7)', () => {
    const table = findCreateTable('stripe_webhook_events');
    const columns = listColumns(table!);
    const attemptsCol = columns.find((c) => c.colname === 'attempts');
    expect(attemptsCol).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(attemptsCol, 'Constraint');
    const hasNotNull = constraints.some((c) => c.contype === 'CONSTR_NOTNULL' || c.contype === 1);
    expect(hasNotNull).toBe(true);
    const hasDefault = constraints.some((c) => c.contype === 'CONSTR_DEFAULT' || c.contype === 2);
    expect(hasDefault).toBe(true);
  });

  it('Constraint named stripe_webhook_events_attempts_nonneg present at table level', () => {
    const table = findCreateTable('stripe_webhook_events');
    const tableElts = (table!.tableElts as unknown[]) ?? [];
    const tableConstraints = tableElts
      .map((e) => (e as Record<string, unknown>).Constraint as Record<string, unknown> | undefined)
      .filter((c): c is Record<string, unknown> => c !== undefined);
    const conames = tableConstraints
      .map((c) => c.conname)
      .filter((n): n is string => typeof n === 'string');
    expect(conames).toContain('stripe_webhook_events_attempts_nonneg');
    const attemptsCheck = tableConstraints.find(
      (c) => c.conname === 'stripe_webhook_events_attempts_nonneg',
    );
    expect(subtreeContains(attemptsCheck, 'attempts')).toBe(true);
  });

  it('IndexStmt × 3 on stripe_webhook_events: received_idx, unprocessed_idx (partial), stuck_idx (partial)', () => {
    const indices = collectNodes<Record<string, unknown>>(parseTree, 'IndexStmt');
    const tableIndices = indices.filter((idx) => {
      const rel = idx.relation as Record<string, unknown> | undefined;
      return rel?.relname === 'stripe_webhook_events';
    });
    expect(tableIndices.length).toBeGreaterThanOrEqual(3);

    const byName = new Map<string, Record<string, unknown>>();
    for (const idx of tableIndices) {
      if (typeof idx.idxname === 'string') byName.set(idx.idxname, idx);
    }
    expect(byName.has('stripe_webhook_events_received_idx')).toBe(true);
    expect(byName.has('stripe_webhook_events_unprocessed_idx')).toBe(true);
    expect(byName.has('stripe_webhook_events_stuck_idx')).toBe(true);

    // Unprocessed_idx is partial: whereClause references processed_at.
    const unprocessed = byName.get('stripe_webhook_events_unprocessed_idx')!;
    expect(unprocessed.whereClause).toBeDefined();
    expect(subtreeContains(unprocessed.whereClause, 'processed_at')).toBe(true);

    // Stuck_idx is partial: whereClause references both processed_at AND
    // attempts (premortem R7).
    const stuck = byName.get('stripe_webhook_events_stuck_idx')!;
    expect(stuck.whereClause).toBeDefined();
    expect(subtreeContains(stuck.whereClause, 'processed_at')).toBe(true);
    expect(subtreeContains(stuck.whereClause, 'attempts')).toBe(true);
  });

  it('AlterTable ENABLE + FORCE row-level security on stripe_webhook_events (premortem R8)', () => {
    const alters = collectNodes<Record<string, unknown>>(parseTree, 'AlterTableStmt');
    const tableAlters = alters.filter((a) => {
      const rel = a.relation as Record<string, unknown> | undefined;
      return rel?.relname === 'stripe_webhook_events';
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

describe('stripe_webhook_events migration — pglite-applies-cleanly tier', () => {
  it('applies cleanly after 0001..0009 against a fresh pglite instance', async () => {
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
      // Apply t2 + 0013 only if shipped (stripe_webhook_events has no FK
      // to any of them, so the test is ordering-agnostic).
      for (const name of [
        '0010_time_wallets.sql',
        '0011_time_ledger.sql',
        '0012_time_ledger_balance_trigger.sql',
        '0013_disputes.sql',
      ]) {
        try {
          const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
          await runSqlBlock(pg, sql);
        } catch {
          // Not yet shipped — skip.
        }
      }
      // Migration under test.
      await runSqlBlock(pg, readFileSync(MIGRATION_PATH, 'utf8'));

      // Smoke: table exists.
      const probe = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM stripe_webhook_events`,
      );
      expect(probe.rows[0]?.count).toBe('0');

      // Smoke: RLS forced.
      const rls = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
        SELECT c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'stripe_webhook_events'
      `);
      expect(rls.rows[0]?.relrowsecurity).toBe(true);
      expect(rls.rows[0]?.relforcerowsecurity).toBe(true);

      // Smoke: attempts default is 0 — insert minimal row and assert.
      await runSqlBlock(
        pg,
        `INSERT INTO stripe_webhook_events
           (event_id, event_type, livemode, payload)
         VALUES ('evt_test_1', 'payment_intent.succeeded', false, '{}'::jsonb)`,
      );
      const probe2 = await pg.query<{ attempts: number }>(
        `SELECT attempts FROM stripe_webhook_events WHERE event_id = 'evt_test_1'`,
      );
      expect(probe2.rows[0]?.attempts).toBe(0);
    } finally {
      await pg.close();
    }
  });
});
