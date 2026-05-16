// Migration shape test — ADR-0036 / AC1.
//
// Three fidelity tiers (mirrors tests/migrations/audit-log-shape.test.ts plus
// the pglite-applies-cleanly tier specified by .conductor/36/dispatches/0008):
//
//   1. Regex/substring tier — surface-level lexical assertions. Catches
//      copy-paste obvious mistakes (filename pattern, missing column names,
//      missing index/constraint names, presence of forbidden patterns).
//
//   2. AST tier — pg-query-emscripten parses the migration SQL into the
//      Postgres parse tree. Tests walk specific subtrees to assert semantic
//      properties: column count and primary-key on id, NOT NULL placement,
//      explicit FK to profiles(id) with ON DELETE NO ACTION, CHECK constraints,
//      indexes, ENABLE+FORCE row level security.
//
//   3. pglite-applies-cleanly tier — apply migrations 0001..0007 plus the new
//      0008_payments.sql against a fresh pglite instance and assert success.
//      Catches statement-level errors that the parser cannot (e.g. forward
//      references to tables that do not exist yet, type mismatches against the
//      profiles(id) FK, malformed CHECK predicates).
//
// Premortem coupling (.conductor/36/returns/0004-premortem-schema.md):
//   R1 — currency drift: payments_currency_usd_only CHECK literal AND negative-
//        assert no `currency IN (...)` form.
//   R3 — idempotency_key NULL bypass: partial UNIQUE index ON (idempotency_key)
//        WHERE idempotency_key IS NOT NULL + CHECK (idempotency_key IS NOT
//        NULL OR stripe_event_id IS NOT NULL).
//   R8 — RLS-off window pre-policy-migration: ENABLE+FORCE RLS at end of THIS
//        migration so default-deny is in place before 0016 lands policies.
//   R9 — explicit `ON DELETE NO ACTION` on every REFERENCES profiles(id) to
//        match the 0005_privacy_requests.sql convention; shape test asserts.

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
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, '0008_payments.sql');
const SQL = readFileSync(MIGRATION_PATH, 'utf8');

// Helper: run a raw multi-statement SQL block against pglite. The pglite
// `.exec` entrypoint is the multi-statement runner (named to avoid the JS
// ProcessBuilder method on Node's child_process module).
async function runSqlBlock(pg: PGlite, sql: string): Promise<void> {
  const runner = (pg as unknown as { exec: (s: string) => Promise<unknown> })['exec'];
  await runner.call(pg, sql);
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const SQL_NO_COMMENTS = stripComments(SQL);

// -----------------------------------------------------------------------------
// Tier 1 — Regex / substring assertions (AC1 lexical tier)
// -----------------------------------------------------------------------------

describe('payments migration — regex tier (AC1 lexical assertions)', () => {
  it('filename matches NNNN_<snake_case>.sql convention and the slice-1 specific name', () => {
    const filename = MIGRATION_PATH.split(/[\\/]/).pop() ?? '';
    expect(filename).toMatch(/^0008_payments\.sql$/);
    expect(filename).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('creates payments table with all 12 v1 column names', () => {
    expect(SQL).toMatch(/CREATE\s+TABLE\s+payments/i);
    for (const col of [
      'id',
      'stripe_object_id',
      'kind',
      'profile_id',
      'amount_cents',
      'currency',
      'status',
      'stripe_event_id',
      'raw_event',
      'idempotency_key',
      'created_at',
      'updated_at',
    ]) {
      expect(SQL).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('id column uses bigserial PRIMARY KEY (ADR-0036 §Data model)', () => {
    expect(SQL).toMatch(/\bbigserial\b/i);
    expect(SQL).toMatch(/\bid\b[^,]*bigserial[^,]*PRIMARY\s+KEY/i);
  });

  it('profile_id references profiles(id) with explicit ON DELETE NO ACTION (premortem R9)', () => {
    expect(SQL).toMatch(
      /profile_id[^,]*uuid[^,]*NOT\s+NULL[^,]*REFERENCES\s+profiles\s*\(\s*id\s*\)\s+ON\s+DELETE\s+NO\s+ACTION/i,
    );
  });

  it('declares payments_stripe_object_kind_unique composite UNIQUE constraint', () => {
    expect(SQL).toMatch(
      /CONSTRAINT\s+payments_stripe_object_kind_unique\s+UNIQUE\s*\(\s*stripe_object_id\s*,\s*kind\s*\)/i,
    );
  });

  it("declares payments_currency_usd_only CHECK (currency = 'usd') (premortem R1)", () => {
    // Belt-and-suspenders beyond ADR-0004 prose — DB-level enforcement of
    // the USD-only invariant. The CHECK MUST be literal equality to 'usd';
    // do not relax to `currency IN ('usd', ...)` without an ADR amendment.
    expect(SQL).toMatch(
      /CONSTRAINT\s+payments_currency_usd_only\s+CHECK\s*\(\s*currency\s*=\s*'usd'\s*\)/i,
    );
  });

  it('does NOT declare a `currency IN (...)` disjunctive form (premortem R1 negative-assert)', () => {
    // Strip comments first so the load-bearing INVARIANT comment that
    // mentions the forbidden pattern does not trip the test.
    expect(SQL_NO_COMMENTS).not.toMatch(/currency\s+IN\s*\(/i);
  });

  it('declares payments_idem_or_audit_trail CHECK (idempotency_key IS NOT NULL OR stripe_event_id IS NOT NULL) (premortem R3)', () => {
    // R3: NULL idempotency_key is allowed (webhook rows use stripe_event_id
    // as the anchor) but at least one of the two traceability anchors MUST
    // be present on every row.
    expect(SQL).toMatch(
      /CONSTRAINT\s+payments_idem_or_audit_trail\s+CHECK\s*\(\s*idempotency_key\s+IS\s+NOT\s+NULL\s+OR\s+stripe_event_id\s+IS\s+NOT\s+NULL\s*\)/i,
    );
  });

  it('declares the partial UNIQUE index payments_idempotency_key_unique WHERE NOT NULL (premortem R3)', () => {
    // R3: bare UNIQUE on a nullable column does not prevent duplicate NULLs
    // in PostgreSQL — webhook double-write could land three NULL-keyed rows
    // before anything noticed. Partial UNIQUE constrains the not-null cohort.
    expect(SQL).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+payments_idempotency_key_unique\s+ON\s+payments\s*\(\s*idempotency_key\s*\)\s+WHERE\s+idempotency_key\s+IS\s+NOT\s+NULL/i,
    );
  });

  it('declares payments_profile_idx on (profile_id, created_at DESC)', () => {
    expect(SQL).toMatch(/CREATE\s+INDEX\s+payments_profile_idx/i);
    expect(SQL).toMatch(
      /payments_profile_idx\s+ON\s+payments\s*\(\s*profile_id\s*,\s*created_at\s+DESC\s*\)/i,
    );
  });

  it('declares payments_kind_status_idx on (kind, status, created_at DESC)', () => {
    expect(SQL).toMatch(/CREATE\s+INDEX\s+payments_kind_status_idx/i);
    expect(SQL).toMatch(
      /payments_kind_status_idx\s+ON\s+payments\s*\(\s*kind\s*,\s*status\s*,\s*created_at\s+DESC\s*\)/i,
    );
  });

  it('enables AND forces row-level security on payments (premortem R8)', () => {
    // R8: each table-creating migration enables+forces RLS in the SAME file
    // so the dangerous "ENABLE-deferred-to-0016" window is zero. Policies
    // land later in 0016_payments_rls.sql.
    expect(SQL).toMatch(/ALTER\s+TABLE\s+payments\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(SQL).toMatch(/ALTER\s+TABLE\s+payments\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('does NOT declare any CREATE POLICY in this migration (policies land in 0016)', () => {
    // Strip comments so doc-references to "policy" language do not trip
    // the test.
    expect(SQL_NO_COMMENTS).not.toMatch(/CREATE\s+POLICY\s+/i);
  });

  it('contains NO ON DELETE CASCADE or ON DELETE SET NULL (privacy-trail invariant)', () => {
    expect(SQL_NO_COMMENTS).not.toMatch(/ON\s+DELETE\s+CASCADE/i);
    expect(SQL_NO_COMMENTS).not.toMatch(/ON\s+DELETE\s+SET\s+NULL/i);
  });

  it('contains COMMENT ON TABLE payments documenting ADR-0036 ownership', () => {
    expect(SQL).toMatch(/COMMENT\s+ON\s+TABLE\s+payments\s+IS/i);
    const idx = SQL.search(/COMMENT\s+ON\s+TABLE\s+payments\s+IS/i);
    const block = SQL.slice(idx, idx + 1200);
    expect(block).toMatch(/ADR-0036/);
  });

  it('contains COMMENT ON COLUMN payments.currency pinning the USD-only contract', () => {
    expect(SQL).toMatch(/COMMENT\s+ON\s+COLUMN\s+payments\.currency\s+IS/i);
    const idx = SQL.search(/COMMENT\s+ON\s+COLUMN\s+payments\.currency\s+IS/i);
    const block = SQL.slice(idx, idx + 600);
    expect(block).toMatch(/ADR-0004/);
  });

  it('contains the migration-review acknowledgement comment for the blocking indexes', () => {
    // payments table is created EMPTY in this migration — the CREATE INDEX
    // statements lock for microseconds on zero rows. CONCURRENTLY is not an
    // option inside the implicit-transaction migration runner.
    expect(SQL).toMatch(/migration-review:\s+blocking-index-approved/);
  });
});

// -----------------------------------------------------------------------------
// Tier 2 — AST parse-tree assertions (AC1 parser-fidelity tier)
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
      `pg-query-emscripten failed to parse 0008_payments.sql: ${result.error.message}`,
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

describe('payments migration — AST tier (AC1 parser-fidelity assertions)', () => {
  it('parses without error and yields a non-empty stmts array', () => {
    expect(parseTree).toBeDefined();
    expect(Array.isArray(parseTree.stmts)).toBe(true);
    expect((parseTree.stmts ?? []).length).toBeGreaterThan(0);
  });

  it('CreateStmt for payments has all 12 columns in spec order', () => {
    const table = findCreateTable('payments');
    expect(table).toBeDefined();
    const columns = listColumns(table!);
    const names = columns.map((c) => c.colname).filter((n): n is string => typeof n === 'string');
    expect(names).toEqual([
      'id',
      'stripe_object_id',
      'kind',
      'profile_id',
      'amount_cents',
      'currency',
      'status',
      'stripe_event_id',
      'raw_event',
      'idempotency_key',
      'created_at',
      'updated_at',
    ]);
  });

  it('id column has CONSTR_PRIMARY constraint', () => {
    const table = findCreateTable('payments');
    const columns = listColumns(table!);
    const idCol = columns.find((c) => c.colname === 'id');
    expect(idCol).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(idCol, 'Constraint');
    const hasPrimary = constraints.some(
      (c) => c.contype === 'CONSTR_PRIMARY' || c.contype === 5 || c.contype === 6,
    );
    if (!hasPrimary) {
      expect(subtreeContains(idCol, 'CONSTR_PRIMARY')).toBe(true);
    } else {
      expect(hasPrimary).toBe(true);
    }
  });

  it('profile_id has FK to profiles with NO ACTION on delete and IS NOT NULL', () => {
    const table = findCreateTable('payments');
    const columns = listColumns(table!);
    const profileIdCol = columns.find((c) => c.colname === 'profile_id');
    expect(profileIdCol).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(profileIdCol, 'Constraint');

    const fkConstraint = constraints.find((c) => c.contype === 'CONSTR_FOREIGN' || c.contype === 8);
    expect(fkConstraint).toBeDefined();
    const pktable = fkConstraint!.pktable as Record<string, unknown> | undefined;
    expect(pktable?.relname).toBe('profiles');

    // fk_del_action MUST NOT be cascade ('c') or set-null ('n'). Accept
    // 'a' (NO ACTION). Some libpg_query versions emit empty string for the
    // default — the regex tier above pins the explicit text presence, so
    // here we accept either marker.
    const delAction = fkConstraint!.fk_del_action;
    expect(delAction).not.toBe('c');
    expect(delAction).not.toBe('n');
    expect(delAction).not.toBe('CASCADE');
    expect(delAction).not.toBe('SET NULL');
    const acceptable: (string | undefined)[] = ['a', 'NO ACTION', '', undefined];
    expect(acceptable).toContain(delAction as string | undefined);

    const hasNotNull = constraints.some((c) => c.contype === 'CONSTR_NOTNULL' || c.contype === 1);
    expect(hasNotNull).toBe(true);
  });

  it('CHECK + UNIQUE table constraints declare payments_currency_usd_only, payments_idem_or_audit_trail, payments_stripe_object_kind_unique', () => {
    const table = findCreateTable('payments');
    expect(table).toBeDefined();
    // Table-level constraints surface as Constraint nodes with conname set.
    const tableElts = (table!.tableElts as unknown[]) ?? [];
    const tableConstraints = tableElts
      .map((e) => (e as Record<string, unknown>).Constraint as Record<string, unknown> | undefined)
      .filter((c): c is Record<string, unknown> => c !== undefined);

    const conames = tableConstraints
      .map((c) => c.conname)
      .filter((n): n is string => typeof n === 'string');
    expect(conames).toContain('payments_currency_usd_only');
    expect(conames).toContain('payments_idem_or_audit_trail');
    expect(conames).toContain('payments_stripe_object_kind_unique');

    // Subtree of the currency CHECK must reference 'usd' literal.
    const currencyCheck = tableConstraints.find((c) => c.conname === 'payments_currency_usd_only');
    expect(subtreeContains(currencyCheck, 'usd')).toBe(true);

    // Subtree of the idem-or-audit CHECK must reference both columns.
    const idemCheck = tableConstraints.find((c) => c.conname === 'payments_idem_or_audit_trail');
    expect(subtreeContains(idemCheck, 'idempotency_key')).toBe(true);
    expect(subtreeContains(idemCheck, 'stripe_event_id')).toBe(true);
  });

  it('IndexStmt × 3 on payments: profile_idx, kind_status_idx, partial idempotency_key_unique', () => {
    const indices = collectNodes<Record<string, unknown>>(parseTree, 'IndexStmt');
    const paymentsIndices = indices.filter((idx) => {
      const rel = idx.relation as Record<string, unknown> | undefined;
      return rel?.relname === 'payments';
    });
    expect(paymentsIndices.length).toBeGreaterThanOrEqual(3);

    const byName = new Map<string, Record<string, unknown>>();
    for (const idx of paymentsIndices) {
      if (typeof idx.idxname === 'string') byName.set(idx.idxname, idx);
    }
    expect(byName.has('payments_profile_idx')).toBe(true);
    expect(byName.has('payments_kind_status_idx')).toBe(true);
    expect(byName.has('payments_idempotency_key_unique')).toBe(true);

    // partial UNIQUE: unique=true AND whereClause references idempotency_key.
    const idemUnique = byName.get('payments_idempotency_key_unique')!;
    expect(idemUnique.unique).toBe(true);
    expect(idemUnique.whereClause).toBeDefined();
    expect(idemUnique.whereClause).not.toBeNull();
    expect(subtreeContains(idemUnique.whereClause, 'idempotency_key')).toBe(true);
  });

  it('AlterTable ENABLE + FORCE row-level security on payments (premortem R8)', () => {
    const alters = collectNodes<Record<string, unknown>>(parseTree, 'AlterTableStmt');
    const paymentsAlters = alters.filter((a) => {
      const rel = a.relation as Record<string, unknown> | undefined;
      return rel?.relname === 'payments';
    });
    expect(paymentsAlters.length).toBeGreaterThanOrEqual(2);
    const dump = JSON.stringify(paymentsAlters);
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
//
// Apply migrations 0001..0007 in order plus 0008_payments.sql against a fresh
// pglite instance. Asserts statement-level success — catches forward-reference
// errors, type mismatches against the profiles(id) FK, malformed CHECK
// predicates, and any pglite-specific syntax rejection.

describe('payments migration — pglite-applies-cleanly tier', () => {
  it('applies cleanly after 0001..0007 against a fresh pglite instance', async () => {
    const pg = new PGlite({ extensions: { pgcrypto } });
    try {
      // auth schema + stub auth.users so 0003's actor_id FK resolves.
      // Mirrors tests/db/rls-privacy-requests.test.ts beforeAll setup.
      await runSqlBlock(pg, 'CREATE SCHEMA IF NOT EXISTS auth');
      await runSqlBlock(
        pg,
        `CREATE TABLE IF NOT EXISTS auth.users (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid()
        );`,
      );
      // Auth-stub functions — 0002 references auth.uid() in trigger bodies.
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
      ]) {
        const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
        await runSqlBlock(pg, sql);
      }

      // Smoke: payments table exists.
      const probe = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM payments`,
      );
      expect(probe.rows[0]?.count).toBe('0');

      // Smoke: information_schema confirms RLS is forced.
      const rls = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
        SELECT c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'payments'
      `);
      expect(rls.rows[0]?.relrowsecurity).toBe(true);
      expect(rls.rows[0]?.relforcerowsecurity).toBe(true);
    } finally {
      await pg.close();
    }
  });
});
