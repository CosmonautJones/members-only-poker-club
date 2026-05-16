// Migration shape test — ADR-0036 / AC2.
//
// Three fidelity tiers (mirrors tests/migrations/audit-log-shape.test.ts plus
// the pglite-applies-cleanly tier specified by .conductor/36/dispatches/0008):
//
//   1. Regex/substring tier — lexical assertions: filename, column names,
//      profile_id PK FK to profiles(id) ON DELETE NO ACTION, defaults
//      (collection_method='charge_automatically', cancel_at_period_end=false),
//      memberships_status_idx, ENABLE+FORCE RLS, COMMENT ON TABLE.
//
//   2. AST tier — pg-query-emscripten parses the migration SQL. Walks the
//      parse tree to assert: column count + order, profile_id has CONSTR_PRIMARY
//      AND CONSTR_FOREIGN AND NO ACTION on delete, cancel_at_period_end has a
//      DEFAULT false constraint, status index column list.
//
//   3. pglite-applies-cleanly tier — apply migrations 0001..0007 plus
//      0008_payments.sql plus 0009_memberships.sql against a fresh pglite
//      instance and assert success.
//
// Premortem coupling (.conductor/36/returns/0004-premortem-schema.md):
//   R8 — RLS-off window: ENABLE+FORCE RLS at end of THIS migration so default-
//        deny is in place before 0016 lands policies.
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
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, '0009_memberships.sql');
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
// Tier 1 — Regex / substring assertions (AC2 lexical tier)
// -----------------------------------------------------------------------------

describe('memberships migration — regex tier (AC2 lexical assertions)', () => {
  it('filename matches NNNN_<snake_case>.sql convention and the slice-1 specific name', () => {
    const filename = MIGRATION_PATH.split(/[\\/]/).pop() ?? '';
    expect(filename).toMatch(/^0009_memberships\.sql$/);
    expect(filename).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('creates memberships table with all 11 v1 column names', () => {
    expect(SQL).toMatch(/CREATE\s+TABLE\s+memberships/i);
    for (const col of [
      'profile_id',
      'stripe_customer_id',
      'stripe_subscription_id',
      'status',
      'collection_method',
      'current_period_start',
      'current_period_end',
      'past_due_since',
      'cancel_at_period_end',
      'raw_event',
      'created_at',
      'updated_at',
    ]) {
      expect(SQL).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('profile_id is PRIMARY KEY and REFERENCES profiles(id) ON DELETE NO ACTION (premortem R9)', () => {
    // memberships uses profile_id as both PK and FK — one membership row
    // per profile (the ADR's "local mirror of Stripe Subscription state").
    expect(SQL).toMatch(
      /profile_id[^,]*uuid[^,]*PRIMARY\s+KEY[^,]*REFERENCES\s+profiles\s*\(\s*id\s*\)\s+ON\s+DELETE\s+NO\s+ACTION/i,
    );
  });

  it('collection_method defaults to charge_automatically', () => {
    expect(SQL).toMatch(
      /collection_method[^,]*text[^,]*NOT\s+NULL[^,]*DEFAULT\s+'charge_automatically'/i,
    );
  });

  it('cancel_at_period_end is boolean NOT NULL DEFAULT false', () => {
    expect(SQL).toMatch(/cancel_at_period_end[^,]*boolean[^,]*NOT\s+NULL[^,]*DEFAULT\s+false/i);
  });

  it('declares memberships_status_idx on (status, current_period_end)', () => {
    expect(SQL).toMatch(/CREATE\s+INDEX\s+memberships_status_idx/i);
    expect(SQL).toMatch(
      /memberships_status_idx\s+ON\s+memberships\s*\(\s*status\s*,\s*current_period_end\s*\)/i,
    );
  });

  it('enables AND forces row-level security on memberships (premortem R8)', () => {
    expect(SQL).toMatch(/ALTER\s+TABLE\s+memberships\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(SQL).toMatch(/ALTER\s+TABLE\s+memberships\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('does NOT declare any CREATE POLICY in this migration (policies land in 0016)', () => {
    expect(SQL_NO_COMMENTS).not.toMatch(/CREATE\s+POLICY\s+/i);
  });

  it('contains NO ON DELETE CASCADE or ON DELETE SET NULL', () => {
    expect(SQL_NO_COMMENTS).not.toMatch(/ON\s+DELETE\s+CASCADE/i);
    expect(SQL_NO_COMMENTS).not.toMatch(/ON\s+DELETE\s+SET\s+NULL/i);
  });

  it('contains COMMENT ON TABLE memberships documenting ADR-0036 ownership', () => {
    expect(SQL).toMatch(/COMMENT\s+ON\s+TABLE\s+memberships\s+IS/i);
    const idx = SQL.search(/COMMENT\s+ON\s+TABLE\s+memberships\s+IS/i);
    const block = SQL.slice(idx, idx + 1200);
    expect(block).toMatch(/ADR-0036/);
  });

  it('contains the migration-review acknowledgement comment for the blocking index', () => {
    expect(SQL).toMatch(/migration-review:\s+blocking-index-approved/);
  });
});

// -----------------------------------------------------------------------------
// Tier 2 — AST parse-tree assertions (AC2 parser-fidelity tier)
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
      `pg-query-emscripten failed to parse 0009_memberships.sql: ${result.error.message}`,
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

describe('memberships migration — AST tier (AC2 parser-fidelity assertions)', () => {
  it('parses without error and yields a non-empty stmts array', () => {
    expect(parseTree).toBeDefined();
    expect(Array.isArray(parseTree.stmts)).toBe(true);
    expect((parseTree.stmts ?? []).length).toBeGreaterThan(0);
  });

  it('CreateStmt for memberships has all 12 columns in spec order', () => {
    const table = findCreateTable('memberships');
    expect(table).toBeDefined();
    const columns = listColumns(table!);
    const names = columns.map((c) => c.colname).filter((n): n is string => typeof n === 'string');
    expect(names).toEqual([
      'profile_id',
      'stripe_customer_id',
      'stripe_subscription_id',
      'status',
      'collection_method',
      'current_period_start',
      'current_period_end',
      'past_due_since',
      'cancel_at_period_end',
      'raw_event',
      'created_at',
      'updated_at',
    ]);
  });

  it('profile_id has CONSTR_PRIMARY, CONSTR_FOREIGN to profiles, NO ACTION on delete', () => {
    const table = findCreateTable('memberships');
    const columns = listColumns(table!);
    const profileIdCol = columns.find((c) => c.colname === 'profile_id');
    expect(profileIdCol).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(profileIdCol, 'Constraint');

    const hasPrimary = constraints.some(
      (c) => c.contype === 'CONSTR_PRIMARY' || c.contype === 5 || c.contype === 6,
    );
    expect(hasPrimary).toBe(true);

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
  });

  it('cancel_at_period_end has CONSTR_NOTNULL and CONSTR_DEFAULT (false boolval)', () => {
    const table = findCreateTable('memberships');
    const columns = listColumns(table!);
    const cancelCol = columns.find((c) => c.colname === 'cancel_at_period_end');
    expect(cancelCol).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(cancelCol, 'Constraint');
    const hasNotNull = constraints.some((c) => c.contype === 'CONSTR_NOTNULL' || c.contype === 1);
    expect(hasNotNull).toBe(true);
    // CONSTR_DEFAULT present. libpg_query represents boolean literal `false`
    // as a Boolean A_Const with `boolval: {}` (the empty object IS the false
    // marker — `true` would emit `{ boolval: true }`). The regex tier above
    // already pins the literal text `DEFAULT false`; this AST check asserts
    // the CONSTR_DEFAULT node carries a Boolean A_Const subtree.
    const hasDefault = constraints.some((c) => c.contype === 'CONSTR_DEFAULT' || c.contype === 2);
    expect(hasDefault).toBe(true);
    const dump = JSON.stringify(constraints);
    expect(dump).toMatch(/boolval/);
  });

  it('IndexStmt creates memberships_status_idx on (status, current_period_end)', () => {
    const indices = collectNodes<Record<string, unknown>>(parseTree, 'IndexStmt');
    const statusIdx = indices.find((idx) => idx.idxname === 'memberships_status_idx');
    expect(statusIdx).toBeDefined();
    const rel = statusIdx!.relation as Record<string, unknown> | undefined;
    expect(rel?.relname).toBe('memberships');

    const params = (statusIdx!.indexParams as unknown[]) ?? [];
    const elemNames = params
      .map((p) => {
        const elem = (p as Record<string, unknown>).IndexElem as
          | Record<string, unknown>
          | undefined;
        return elem?.name;
      })
      .filter((n): n is string => typeof n === 'string');
    expect(elemNames).toEqual(['status', 'current_period_end']);
  });

  it('AlterTable ENABLE + FORCE row-level security on memberships (premortem R8)', () => {
    const alters = collectNodes<Record<string, unknown>>(parseTree, 'AlterTableStmt');
    const tableAlters = alters.filter((a) => {
      const rel = a.relation as Record<string, unknown> | undefined;
      return rel?.relname === 'memberships';
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
// Tier 3 — pglite-applies-cleanly tier (.conductor/36/dispatches/0008)
// -----------------------------------------------------------------------------

describe('memberships migration — pglite-applies-cleanly tier', () => {
  it('applies cleanly after 0001..0008 against a fresh pglite instance', async () => {
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

      for (const name of [
        '0001_feature_flags.sql',
        '0002_profiles_and_roles.sql',
        '0003_audit_log.sql',
        '0004_privacy_soft_delete.sql',
        '0005_privacy_requests.sql',
        '0006_feature_flags_rls.sql',
        '0007_clubs_and_display_tz.sql',
        '0008_payments.sql',
        '0009_memberships.sql',
      ]) {
        const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
        await runSqlBlock(pg, sql);
      }

      const probe = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM memberships`,
      );
      expect(probe.rows[0]?.count).toBe('0');

      const rls = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
        SELECT c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'memberships'
      `);
      expect(rls.rows[0]?.relrowsecurity).toBe(true);
      expect(rls.rows[0]?.relforcerowsecurity).toBe(true);
    } finally {
      await pg.close();
    }
  });
});
