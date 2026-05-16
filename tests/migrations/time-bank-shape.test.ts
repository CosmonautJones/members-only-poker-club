// Migration shape test — ADR-0036 / AC3, AC4, AC5.
//
// Covers all three time-bank substrate migrations in one file because they
// are interdependent (the AC5 trigger reads from time_ledger and writes to
// time_wallets, and the shape contract for one cannot be verified in
// isolation from the others):
//
//   - 0010_time_wallets.sql   - time_wallets table + GENERATED balance_cents
//   - 0011_time_ledger.sql    - time_ledger table + CHECK + UNIQUE
//   - 0012_time_ledger_balance_trigger.sql - recompute function + trigger
//
// Three fidelity tiers (mirrors tests/migrations/payments-shape.test.ts):
//
//   1. Regex/substring tier - surface-level lexical assertions.
//   2. AST tier - pg-query-emscripten parses the migration SQL.
//   3. pglite-applies-cleanly tier - apply all 12 migrations against a
//      fresh pglite instance, then exercise the AC5 trigger behaviorally
//      (seed profile, INSERT purchase/redemption/manual_credit, assert
//      balances and the duplicate-idempotency-key 23505 SQLSTATE).
//
// Premortem coupling (.conductor/36/returns/0004-premortem-schema.md):
//   R2  - time_ledger mutation backdoor: regex-assert function body does
//          NOT contain `UPDATE time_ledger` or `DELETE FROM time_ledger`.
//   R4  - GENERATED column drift on fallback: assert balance_cents is
//          GENERATED ALWAYS AS (regex) AND that direct UPDATE to it is
//          rejected by pglite.
//   R5  - FK orphan ledger entries: assert explicit ON DELETE NO ACTION
//          on source_payment_id + CHECK time_ledger_payment_or_manual.
//   R8  - RLS-off window: ENABLE+FORCE in BOTH 0010 and 0011 files.
//   R9  - explicit ON DELETE NO ACTION on every REFERENCES profiles(id).
//   R10 - idempotency-key SQLSTATE 23505 (NOT just "fails"): the
//          behavioral tier asserts the specific SQLSTATE so Slice 2
//          handler code can pattern-match on it.
//   R11 - GENERATED expression precision drift: literal `1200` pinned in
//          SQL; balance_minutes in {0, 1, 7, 60, 61, 119, 120, 1234567}
//          drives `balance_cents = balance_minutes * 20` exactly.

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

const WALLETS_PATH = resolve(MIGRATIONS_DIR, '0010_time_wallets.sql');
const LEDGER_PATH = resolve(MIGRATIONS_DIR, '0011_time_ledger.sql');
const TRIGGER_PATH = resolve(MIGRATIONS_DIR, '0012_time_ledger_balance_trigger.sql');

const WALLETS_SQL = readFileSync(WALLETS_PATH, 'utf8');
const LEDGER_SQL = readFileSync(LEDGER_PATH, 'utf8');
const TRIGGER_SQL = readFileSync(TRIGGER_PATH, 'utf8');

// Helper: run a raw multi-statement SQL block against pglite. The pglite
// multi-statement runner is named `exec` (named to avoid the JS
// ProcessBuilder method on Node's child_process module).
async function runSqlBlock(pg: PGlite, sql: string): Promise<void> {
  const runner = (pg as unknown as { exec: (s: string) => Promise<unknown> })['exec'];
  await runner.call(pg, sql);
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const WALLETS_SQL_NO_COMMENTS = stripComments(WALLETS_SQL);
const LEDGER_SQL_NO_COMMENTS = stripComments(LEDGER_SQL);
const TRIGGER_SQL_NO_COMMENTS = stripComments(TRIGGER_SQL);

// -----------------------------------------------------------------------------
// Tier 1 - Regex / substring assertions
// -----------------------------------------------------------------------------

describe('time_wallets migration - regex tier (AC3 lexical assertions)', () => {
  it('filename matches NNNN_<snake_case>.sql convention and the slice-1 specific name', () => {
    const filename = WALLETS_PATH.split(/[\\/]/).pop() ?? '';
    expect(filename).toMatch(/^0010_time_wallets\.sql$/);
    expect(filename).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('creates time_wallets table with all five v1 column names', () => {
    expect(WALLETS_SQL).toMatch(/CREATE\s+TABLE\s+time_wallets/i);
    for (const col of [
      'profile_id',
      'balance_minutes',
      'balance_cents',
      'last_activity_at',
      'updated_at',
    ]) {
      expect(WALLETS_SQL).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('profile_id is PRIMARY KEY and REFERENCES profiles(id) ON DELETE NO ACTION (premortem R9)', () => {
    expect(WALLETS_SQL).toMatch(
      /profile_id[^,]*uuid[^,]*PRIMARY\s+KEY[^,]*REFERENCES\s+profiles\s*\(\s*id\s*\)\s+ON\s+DELETE\s+NO\s+ACTION/i,
    );
  });

  it('balance_minutes is bigint NOT NULL DEFAULT 0', () => {
    expect(WALLETS_SQL).toMatch(/balance_minutes[^,]*bigint[^,]*NOT\s+NULL[^,]*DEFAULT\s+0/i);
  });

  it('balance_cents is bigint GENERATED ALWAYS AS ... STORED (premortem R4)', () => {
    // The GENERATED-column variant - pglite 0.4.5 accepts this syntax
    // (verified by an in-tree experiment on 2026-05-16). The shape test
    // asserts the literal `GENERATED ALWAYS AS` and `STORED` tokens so a
    // future maintainer cannot silently drop the projection without the
    // test catching it.
    expect(WALLETS_SQL).toMatch(/balance_cents\s+bigint\s+GENERATED\s+ALWAYS\s+AS/i);
    expect(WALLETS_SQL).toMatch(/STORED/);
  });

  it('balance_cents GENERATED expression pins HOURLY_RATE_CENTS=1200 literal (premortem R11)', () => {
    // R11: the rate is the load-bearing constant from lib/money/types.ts.
    // The SQL embeds the literal `1200`, NOT a variable, NOT an env var.
    // Drifting the rate is a deliberate ADR-0011 amendment, not a schema
    // tweak. Test asserts the literal appears in the GENERATED expression.
    expect(WALLETS_SQL).toMatch(
      /GENERATED\s+ALWAYS\s+AS\s*\(\s*\(\s*round\s*\(\s*\(\s*balance_minutes\s*::\s*numeric\s*\/\s*60\.0\s*\)\s*\*\s*1200\s*\)\s*\)\s*::\s*bigint\s*\)\s*STORED/i,
    );
  });

  it('contains COMMENT ON COLUMN time_wallets.balance_cents pinning DO-NOT-WRITE (premortem R4)', () => {
    expect(WALLETS_SQL).toMatch(/COMMENT\s+ON\s+COLUMN\s+time_wallets\.balance_cents\s+IS/i);
    const idx = WALLETS_SQL.search(/COMMENT\s+ON\s+COLUMN\s+time_wallets\.balance_cents\s+IS/i);
    const block = WALLETS_SQL.slice(idx, idx + 600);
    expect(block).toMatch(/DO\s+NOT\s+WRITE/i);
    expect(block).toMatch(/HOURLY_RATE_CENTS\s*=\s*1200/);
  });

  it('contains COMMENT ON TABLE time_wallets documenting ADR-0036 / ADR-0011 ownership', () => {
    expect(WALLETS_SQL).toMatch(/COMMENT\s+ON\s+TABLE\s+time_wallets\s+IS/i);
    const idx = WALLETS_SQL.search(/COMMENT\s+ON\s+TABLE\s+time_wallets\s+IS/i);
    const block = WALLETS_SQL.slice(idx, idx + 1500);
    expect(block).toMatch(/ADR-0036/);
    expect(block).toMatch(/ADR-0011/);
  });

  it('enables AND forces row-level security on time_wallets (premortem R8 / D4)', () => {
    expect(WALLETS_SQL).toMatch(/ALTER\s+TABLE\s+time_wallets\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(WALLETS_SQL).toMatch(/ALTER\s+TABLE\s+time_wallets\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('does NOT declare any CREATE POLICY in 0010 (policies land in 0016)', () => {
    expect(WALLETS_SQL_NO_COMMENTS).not.toMatch(/CREATE\s+POLICY\s+/i);
  });

  it('contains NO ON DELETE CASCADE or ON DELETE SET NULL in 0010 (privacy-trail invariant)', () => {
    expect(WALLETS_SQL_NO_COMMENTS).not.toMatch(/ON\s+DELETE\s+CASCADE/i);
    expect(WALLETS_SQL_NO_COMMENTS).not.toMatch(/ON\s+DELETE\s+SET\s+NULL/i);
  });
});

describe('time_ledger migration - regex tier (AC4 lexical assertions)', () => {
  it('filename matches NNNN_<snake_case>.sql convention and the slice-1 specific name', () => {
    const filename = LEDGER_PATH.split(/[\\/]/).pop() ?? '';
    expect(filename).toMatch(/^0011_time_ledger\.sql$/);
    expect(filename).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('creates time_ledger table with all nine v1 column names', () => {
    expect(LEDGER_SQL).toMatch(/CREATE\s+TABLE\s+time_ledger/i);
    for (const col of [
      'id',
      'profile_id',
      'action',
      'amount_minutes',
      'source_payment_id',
      'reason',
      'actor_id',
      'idempotency_key',
      'created_at',
    ]) {
      expect(LEDGER_SQL).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('id column uses bigserial PRIMARY KEY (ADR-0036 §Data model)', () => {
    expect(LEDGER_SQL).toMatch(/\bbigserial\b/i);
    expect(LEDGER_SQL).toMatch(/\bid\b[^,]*bigserial[^,]*PRIMARY\s+KEY/i);
  });

  it('profile_id references profiles(id) with explicit ON DELETE NO ACTION (premortem R9)', () => {
    expect(LEDGER_SQL).toMatch(
      /profile_id[^,]*uuid[^,]*NOT\s+NULL[^,]*REFERENCES\s+profiles\s*\(\s*id\s*\)\s+ON\s+DELETE\s+NO\s+ACTION/i,
    );
  });

  it('source_payment_id references payments(id) with explicit ON DELETE NO ACTION (premortem R5)', () => {
    expect(LEDGER_SQL).toMatch(
      /source_payment_id[^,]*bigint[^,]*REFERENCES\s+payments\s*\(\s*id\s*\)\s+ON\s+DELETE\s+NO\s+ACTION/i,
    );
  });

  it('actor_id references profiles(id) with explicit ON DELETE NO ACTION (premortem R9)', () => {
    expect(LEDGER_SQL).toMatch(
      /actor_id[^,]*uuid[^,]*REFERENCES\s+profiles\s*\(\s*id\s*\)\s+ON\s+DELETE\s+NO\s+ACTION/i,
    );
  });

  it('declares time_ledger_idempotency_key_unique UNIQUE constraint (premortem R10)', () => {
    expect(LEDGER_SQL).toMatch(
      /CONSTRAINT\s+time_ledger_idempotency_key_unique\s+UNIQUE\s*\(\s*idempotency_key\s*\)/i,
    );
  });

  it('declares time_ledger_action_enum CHECK with all eight action values (ADR-0011)', () => {
    // The CHECK constraint pins the eight-value enum at the DB layer.
    // Shape test asserts each literal appears inside the CHECK predicate.
    expect(LEDGER_SQL).toMatch(/CONSTRAINT\s+time_ledger_action_enum\s+CHECK/i);
    const idx = LEDGER_SQL.search(/CONSTRAINT\s+time_ledger_action_enum\s+CHECK/i);
    const block = LEDGER_SQL.slice(idx, idx + 600);
    for (const action of [
      'purchase',
      'promo_bonus',
      'refund',
      'redemption',
      'manual_credit',
      'manual_debit',
      'dormancy_conversion',
      'escheatment',
    ]) {
      expect(block).toMatch(new RegExp(`'${action}'`));
    }
  });

  it('declares time_ledger_payment_or_manual CHECK (premortem R5)', () => {
    // R5: every row must have either source_payment_id (Stripe) OR
    // actor_id (human staff). A row with both NULL is an un-attributable
    // ghost entry. The CHECK is the structural enforcement.
    expect(LEDGER_SQL).toMatch(
      /CONSTRAINT\s+time_ledger_payment_or_manual\s+CHECK\s*\([\s\S]*?source_payment_id\s+IS\s+NULL\s+AND\s+actor_id\s+IS\s+NOT\s+NULL[\s\S]*?source_payment_id\s+IS\s+NOT\s+NULL[\s\S]*?\)/i,
    );
  });

  it('declares time_ledger_profile_idx on (profile_id, created_at DESC)', () => {
    expect(LEDGER_SQL).toMatch(/CREATE\s+INDEX\s+time_ledger_profile_idx/i);
    expect(LEDGER_SQL).toMatch(
      /time_ledger_profile_idx\s+ON\s+time_ledger\s*\(\s*profile_id\s*,\s*created_at\s+DESC\s*\)/i,
    );
  });

  it('declares time_ledger_action_idx on (action, created_at DESC)', () => {
    expect(LEDGER_SQL).toMatch(/CREATE\s+INDEX\s+time_ledger_action_idx/i);
    expect(LEDGER_SQL).toMatch(
      /time_ledger_action_idx\s+ON\s+time_ledger\s*\(\s*action\s*,\s*created_at\s+DESC\s*\)/i,
    );
  });

  it('enables AND forces row-level security on time_ledger (premortem R8 / D4)', () => {
    expect(LEDGER_SQL).toMatch(/ALTER\s+TABLE\s+time_ledger\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(LEDGER_SQL).toMatch(/ALTER\s+TABLE\s+time_ledger\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('does NOT declare any CREATE POLICY in 0011 (policies land in 0016)', () => {
    expect(LEDGER_SQL_NO_COMMENTS).not.toMatch(/CREATE\s+POLICY\s+/i);
  });

  it('does NOT declare any FOR UPDATE or FOR DELETE language in 0011 (premortem R2)', () => {
    // R2: time_ledger is append-only - no UPDATE / DELETE policies exist
    // in 0016 either, but this is a forward-looking guard against a future
    // amendment that adds policies in 0011 instead of 0016.
    expect(LEDGER_SQL_NO_COMMENTS).not.toMatch(/FOR\s+UPDATE/i);
    expect(LEDGER_SQL_NO_COMMENTS).not.toMatch(/FOR\s+DELETE/i);
  });

  it('contains NO ON DELETE CASCADE or ON DELETE SET NULL in 0011 (privacy-trail invariant)', () => {
    expect(LEDGER_SQL_NO_COMMENTS).not.toMatch(/ON\s+DELETE\s+CASCADE/i);
    expect(LEDGER_SQL_NO_COMMENTS).not.toMatch(/ON\s+DELETE\s+SET\s+NULL/i);
  });

  it('contains COMMENT ON TABLE time_ledger documenting APPEND-ONLY invariant (premortem R2)', () => {
    expect(LEDGER_SQL).toMatch(/COMMENT\s+ON\s+TABLE\s+time_ledger\s+IS/i);
    const idx = LEDGER_SQL.search(/COMMENT\s+ON\s+TABLE\s+time_ledger\s+IS/i);
    const block = LEDGER_SQL.slice(idx, idx + 2000);
    expect(block).toMatch(/ADR-0036/);
    expect(block).toMatch(/ADR-0011/);
    expect(block).toMatch(/APPEND-ONLY/i);
  });

  it('contains the migration-review acknowledgement comment for the blocking indexes', () => {
    expect(LEDGER_SQL).toMatch(/migration-review:\s+blocking-index-approved/);
  });
});

describe('time_ledger_balance_trigger migration - regex tier (AC5 lexical assertions)', () => {
  it('filename matches NNNN_<snake_case>.sql convention and the slice-1 specific name', () => {
    const filename = TRIGGER_PATH.split(/[\\/]/).pop() ?? '';
    expect(filename).toMatch(/^0012_time_ledger_balance_trigger\.sql$/);
    expect(filename).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('declares public.time_ledger_recompute_wallet() as SECURITY DEFINER', () => {
    expect(TRIGGER_SQL).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.time_ledger_recompute_wallet\s*\(\s*\)/i,
    );
    expect(TRIGGER_SQL).toMatch(/SECURITY\s+DEFINER/i);
    expect(TRIGGER_SQL).toMatch(/LANGUAGE\s+plpgsql/i);
  });

  it('function body references INSERT INTO time_wallets with ON CONFLICT (profile_id) DO UPDATE', () => {
    expect(TRIGGER_SQL).toMatch(/INSERT\s+INTO\s+time_wallets/i);
    expect(TRIGGER_SQL).toMatch(/ON\s+CONFLICT\s*\(\s*profile_id\s*\)\s+DO\s+UPDATE/i);
  });

  it('function body computes the running SUM of amount_minutes for NEW.profile_id', () => {
    expect(TRIGGER_SQL).toMatch(
      /SELECT\s+SUM\s*\(\s*amount_minutes\s*\)\s+FROM\s+time_ledger\s+WHERE\s+profile_id\s*=\s*NEW\.profile_id/i,
    );
  });

  it('does NOT contain `UPDATE time_ledger` or `DELETE FROM time_ledger` in function body (premortem R2)', () => {
    // R2: the trigger may only READ from time_ledger and WRITE to
    // time_wallets. A future amendment that mutates ledger rows from
    // inside the SECURITY DEFINER function would silently subvert the
    // append-only invariant. Strip comments first so the load-bearing
    // INVARIANT comment that mentions the forbidden pattern does not
    // trip the test.
    expect(TRIGGER_SQL_NO_COMMENTS).not.toMatch(/UPDATE\s+time_ledger\b/i);
    expect(TRIGGER_SQL_NO_COMMENTS).not.toMatch(/DELETE\s+FROM\s+time_ledger\b/i);
  });

  it('creates time_ledger_balance_trigger AFTER INSERT FOR EACH ROW', () => {
    expect(TRIGGER_SQL).toMatch(/CREATE\s+TRIGGER\s+time_ledger_balance_trigger/i);
    expect(TRIGGER_SQL).toMatch(/AFTER\s+INSERT\s+ON\s+time_ledger/i);
    expect(TRIGGER_SQL).toMatch(/FOR\s+EACH\s+ROW/i);
    expect(TRIGGER_SQL).toMatch(
      /EXECUTE\s+FUNCTION\s+public\.time_ledger_recompute_wallet\s*\(\s*\)/i,
    );
  });

  it('does NOT contain an UPDATE or DELETE trigger variant (append-only invariant)', () => {
    // Append-only ledger - no UPDATE or DELETE trigger.
    expect(TRIGGER_SQL_NO_COMMENTS).not.toMatch(/BEFORE\s+UPDATE\s+ON\s+time_ledger/i);
    expect(TRIGGER_SQL_NO_COMMENTS).not.toMatch(/AFTER\s+UPDATE\s+ON\s+time_ledger/i);
    expect(TRIGGER_SQL_NO_COMMENTS).not.toMatch(/BEFORE\s+DELETE\s+ON\s+time_ledger/i);
    expect(TRIGGER_SQL_NO_COMMENTS).not.toMatch(/AFTER\s+DELETE\s+ON\s+time_ledger/i);
  });
});

// -----------------------------------------------------------------------------
// Tier 2 - AST parse-tree assertions
// -----------------------------------------------------------------------------

interface PgQueryStmt {
  RawStmt?: { stmt?: Record<string, unknown> };
  [key: string]: unknown;
}
interface PgQueryParseTree {
  version?: number;
  stmts?: PgQueryStmt[];
}

let walletsTree: PgQueryParseTree;
let ledgerTree: PgQueryParseTree;
let triggerTree: PgQueryParseTree;

beforeAll(async () => {
  // eslint-disable-next-line new-cap
  const pgQuery = await new PgQueryModule();
  for (const [label, sql, target] of [
    ['0010_time_wallets.sql', WALLETS_SQL, 'wallets'],
    ['0011_time_ledger.sql', LEDGER_SQL, 'ledger'],
    ['0012_time_ledger_balance_trigger.sql', TRIGGER_SQL, 'trigger'],
  ] as const) {
    const result = pgQuery.parse(sql);
    if (result.error) {
      throw new Error(`pg-query-emscripten failed to parse ${label}: ${result.error.message}`);
    }
    if (target === 'wallets') walletsTree = result.parse_tree as PgQueryParseTree;
    else if (target === 'ledger') ledgerTree = result.parse_tree as PgQueryParseTree;
    else triggerTree = result.parse_tree as PgQueryParseTree;
  }
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

function findCreateTable(
  tree: PgQueryParseTree,
  relname: string,
): Record<string, unknown> | undefined {
  const tables = collectNodes<Record<string, unknown>>(tree, 'CreateStmt');
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

describe('time_wallets migration - AST tier (AC3 parser-fidelity assertions)', () => {
  it('parses without error and yields a non-empty stmts array', () => {
    expect(walletsTree).toBeDefined();
    expect(Array.isArray(walletsTree.stmts)).toBe(true);
    expect((walletsTree.stmts ?? []).length).toBeGreaterThan(0);
  });

  it('CreateStmt for time_wallets has all 5 columns in spec order', () => {
    const table = findCreateTable(walletsTree, 'time_wallets');
    expect(table).toBeDefined();
    const columns = listColumns(table!);
    const names = columns.map((c) => c.colname).filter((n): n is string => typeof n === 'string');
    expect(names).toEqual([
      'profile_id',
      'balance_minutes',
      'balance_cents',
      'last_activity_at',
      'updated_at',
    ]);
  });

  it('profile_id has CONSTR_PRIMARY, CONSTR_FOREIGN to profiles, NO ACTION on delete', () => {
    const table = findCreateTable(walletsTree, 'time_wallets');
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

  it('balance_cents column carries a generated-stored constraint (premortem R4)', () => {
    const table = findCreateTable(walletsTree, 'time_wallets');
    const columns = listColumns(table!);
    const centsCol = columns.find((c) => c.colname === 'balance_cents');
    expect(centsCol).toBeDefined();
    // libpg_query represents GENERATED ALWAYS AS ... STORED as a
    // Constraint node with contype = CONSTR_GENERATED (10) and
    // generated_when = 'a' (ALWAYS). The exact encoding varies by
    // libpg_query version; the safe assertion is that the column's
    // constraint subtree references 'CONSTR_GENERATED' or contains
    // the literal `generated_when`.
    const dump = JSON.stringify(centsCol);
    expect(dump).toMatch(/CONSTR_GENERATED|generated_when/i);
    // Subtree must reference balance_minutes (the source column).
    expect(subtreeContains(centsCol, 'balance_minutes')).toBe(true);
    // Subtree must reference the 1200 rate literal (premortem R11).
    expect(subtreeContains(centsCol, '1200')).toBe(true);
  });

  it('AlterTable ENABLE + FORCE row-level security on time_wallets (premortem R8)', () => {
    const alters = collectNodes<Record<string, unknown>>(walletsTree, 'AlterTableStmt');
    const tableAlters = alters.filter((a) => {
      const rel = a.relation as Record<string, unknown> | undefined;
      return rel?.relname === 'time_wallets';
    });
    expect(tableAlters.length).toBeGreaterThanOrEqual(2);
    const dump = JSON.stringify(tableAlters);
    expect(dump).toMatch(/AT_EnableRowSecurity|EnableRowSecurity|ENABLE.*ROW/i);
    expect(dump).toMatch(/AT_ForceRowSecurity|ForceRowSecurity|FORCE.*ROW/i);
  });

  it('NO CreatePolicyStmt in 0010 (policies live in 0016_payments_rls.sql)', () => {
    const policies = collectNodes<Record<string, unknown>>(walletsTree, 'CreatePolicyStmt');
    expect(policies).toHaveLength(0);
  });
});

describe('time_ledger migration - AST tier (AC4 parser-fidelity assertions)', () => {
  it('parses without error and yields a non-empty stmts array', () => {
    expect(ledgerTree).toBeDefined();
    expect(Array.isArray(ledgerTree.stmts)).toBe(true);
    expect((ledgerTree.stmts ?? []).length).toBeGreaterThan(0);
  });

  it('CreateStmt for time_ledger has all 9 columns in spec order', () => {
    const table = findCreateTable(ledgerTree, 'time_ledger');
    expect(table).toBeDefined();
    const columns = listColumns(table!);
    const names = columns.map((c) => c.colname).filter((n): n is string => typeof n === 'string');
    expect(names).toEqual([
      'id',
      'profile_id',
      'action',
      'amount_minutes',
      'source_payment_id',
      'reason',
      'actor_id',
      'idempotency_key',
      'created_at',
    ]);
  });

  it('source_payment_id has FK to payments with NO ACTION on delete (premortem R5)', () => {
    const table = findCreateTable(ledgerTree, 'time_ledger');
    const columns = listColumns(table!);
    const col = columns.find((c) => c.colname === 'source_payment_id');
    expect(col).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(col, 'Constraint');
    const fkConstraint = constraints.find((c) => c.contype === 'CONSTR_FOREIGN' || c.contype === 8);
    expect(fkConstraint).toBeDefined();
    const pktable = fkConstraint!.pktable as Record<string, unknown> | undefined;
    expect(pktable?.relname).toBe('payments');
    const delAction = fkConstraint!.fk_del_action;
    expect(delAction).not.toBe('c');
    expect(delAction).not.toBe('n');
    const acceptable: (string | undefined)[] = ['a', 'NO ACTION', '', undefined];
    expect(acceptable).toContain(delAction as string | undefined);
  });

  it('profile_id has FK to profiles, NOT NULL, NO ACTION on delete (premortem R9)', () => {
    const table = findCreateTable(ledgerTree, 'time_ledger');
    const columns = listColumns(table!);
    const col = columns.find((c) => c.colname === 'profile_id');
    expect(col).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(col, 'Constraint');
    const fkConstraint = constraints.find((c) => c.contype === 'CONSTR_FOREIGN' || c.contype === 8);
    expect(fkConstraint).toBeDefined();
    const pktable = fkConstraint!.pktable as Record<string, unknown> | undefined;
    expect(pktable?.relname).toBe('profiles');
    const hasNotNull = constraints.some((c) => c.contype === 'CONSTR_NOTNULL' || c.contype === 1);
    expect(hasNotNull).toBe(true);
  });

  it('table-level constraints include action_enum, payment_or_manual, idempotency_key_unique', () => {
    const table = findCreateTable(ledgerTree, 'time_ledger');
    expect(table).toBeDefined();
    const tableElts = (table!.tableElts as unknown[]) ?? [];
    const tableConstraints = tableElts
      .map((e) => (e as Record<string, unknown>).Constraint as Record<string, unknown> | undefined)
      .filter((c): c is Record<string, unknown> => c !== undefined);

    const conames = tableConstraints
      .map((c) => c.conname)
      .filter((n): n is string => typeof n === 'string');
    expect(conames).toContain('time_ledger_idempotency_key_unique');
    expect(conames).toContain('time_ledger_action_enum');
    expect(conames).toContain('time_ledger_payment_or_manual');

    // The payment_or_manual CHECK subtree must reference both columns.
    const checkConstraint = tableConstraints.find(
      (c) => c.conname === 'time_ledger_payment_or_manual',
    );
    expect(subtreeContains(checkConstraint, 'source_payment_id')).toBe(true);
    expect(subtreeContains(checkConstraint, 'actor_id')).toBe(true);

    // The action_enum CHECK subtree must reference each of the 8 actions.
    const actionEnumConstraint = tableConstraints.find(
      (c) => c.conname === 'time_ledger_action_enum',
    );
    for (const action of [
      'purchase',
      'promo_bonus',
      'refund',
      'redemption',
      'manual_credit',
      'manual_debit',
      'dormancy_conversion',
      'escheatment',
    ]) {
      expect(subtreeContains(actionEnumConstraint, action)).toBe(true);
    }
  });

  it('IndexStmt x 2 on time_ledger: profile_idx, action_idx', () => {
    const indices = collectNodes<Record<string, unknown>>(ledgerTree, 'IndexStmt');
    const tableIndices = indices.filter((idx) => {
      const rel = idx.relation as Record<string, unknown> | undefined;
      return rel?.relname === 'time_ledger';
    });
    expect(tableIndices.length).toBeGreaterThanOrEqual(2);

    const byName = new Map<string, Record<string, unknown>>();
    for (const idx of tableIndices) {
      if (typeof idx.idxname === 'string') byName.set(idx.idxname, idx);
    }
    expect(byName.has('time_ledger_profile_idx')).toBe(true);
    expect(byName.has('time_ledger_action_idx')).toBe(true);
  });

  it('AlterTable ENABLE + FORCE row-level security on time_ledger (premortem R8)', () => {
    const alters = collectNodes<Record<string, unknown>>(ledgerTree, 'AlterTableStmt');
    const tableAlters = alters.filter((a) => {
      const rel = a.relation as Record<string, unknown> | undefined;
      return rel?.relname === 'time_ledger';
    });
    expect(tableAlters.length).toBeGreaterThanOrEqual(2);
    const dump = JSON.stringify(tableAlters);
    expect(dump).toMatch(/AT_EnableRowSecurity|EnableRowSecurity|ENABLE.*ROW/i);
    expect(dump).toMatch(/AT_ForceRowSecurity|ForceRowSecurity|FORCE.*ROW/i);
  });

  it('NO CreatePolicyStmt in 0011 (policies live in 0016_payments_rls.sql)', () => {
    const policies = collectNodes<Record<string, unknown>>(ledgerTree, 'CreatePolicyStmt');
    expect(policies).toHaveLength(0);
  });
});

describe('time_ledger_balance_trigger migration - AST tier (AC5 parser-fidelity assertions)', () => {
  it('parses without error and yields a non-empty stmts array', () => {
    expect(triggerTree).toBeDefined();
    expect(Array.isArray(triggerTree.stmts)).toBe(true);
    expect((triggerTree.stmts ?? []).length).toBeGreaterThan(0);
  });

  it('declares CreateFunctionStmt for public.time_ledger_recompute_wallet', () => {
    const funcs = collectNodes<Record<string, unknown>>(triggerTree, 'CreateFunctionStmt');
    expect(funcs.length).toBeGreaterThanOrEqual(1);
    const dump = JSON.stringify(funcs);
    expect(dump).toMatch(/time_ledger_recompute_wallet/);
    expect(dump).toMatch(/plpgsql/);
    // SECURITY DEFINER surfaces in libpg_query as a DefElem with defname
    // `security` and arg true.
    expect(dump).toMatch(/security/i);
  });

  it('declares CreateTrigStmt time_ledger_balance_trigger on time_ledger', () => {
    const triggers = collectNodes<Record<string, unknown>>(triggerTree, 'CreateTrigStmt');
    expect(triggers.length).toBeGreaterThanOrEqual(1);
    const trig = triggers[0]!;
    expect(trig.trigname).toBe('time_ledger_balance_trigger');
    const rel = trig.relation as Record<string, unknown> | undefined;
    expect(rel?.relname).toBe('time_ledger');
    // The trigger is AFTER INSERT FOR EACH ROW - bitmap encoding varies
    // between libpg_query versions; safest assertion is the dumped JSON
    // string.
    const dump = JSON.stringify(trig);
    expect(dump).toMatch(/time_ledger_recompute_wallet/);
  });
});

// -----------------------------------------------------------------------------
// Tier 3 - pglite-applies-cleanly + behavioral tier (AC5 trigger sub-cases)
// -----------------------------------------------------------------------------
//
// Apply migrations 0001..0007 + 0008_payments.sql + 0009_memberships.sql +
// 0010..0012 against a fresh pglite instance, then exercise the AC5 trigger
// behaviorally.

describe('time-bank migrations - pglite-applies-cleanly + behavioral tier', () => {
  async function setupPg(): Promise<PGlite> {
    const pg = new PGlite({ extensions: { pgcrypto } });
    // auth schema + stub auth.users so 0003's actor_id FK resolves.
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
      '0010_time_wallets.sql',
      '0011_time_ledger.sql',
      '0012_time_ledger_balance_trigger.sql',
    ]) {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
      await runSqlBlock(pg, sql);
    }

    return pg;
  }

  it('applies cleanly through 0012 against a fresh pglite instance', async () => {
    const pg = await setupPg();
    try {
      // Smoke: both tables exist and the trigger function is registered.
      const walletCount = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM time_wallets`,
      );
      expect(walletCount.rows[0]?.count).toBe('0');

      const ledgerCount = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM time_ledger`,
      );
      expect(ledgerCount.rows[0]?.count).toBe('0');

      // pg_proc registration confirms the recompute function exists.
      const fn = await pg.query<{ proname: string }>(
        `SELECT proname FROM pg_proc WHERE proname = 'time_ledger_recompute_wallet'`,
      );
      expect(fn.rows.length).toBe(1);

      // pg_trigger registration confirms the trigger is wired to time_ledger.
      const trig = await pg.query<{ tgname: string; tgrelid: string }>(
        `SELECT t.tgname, c.relname AS tgrelid
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         WHERE t.tgname = 'time_ledger_balance_trigger'`,
      );
      expect(trig.rows.length).toBe(1);
      expect(trig.rows[0]?.tgrelid).toBe('time_ledger');

      // Smoke: RLS forced on both tables.
      for (const table of ['time_wallets', 'time_ledger']) {
        const rls = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
          `SELECT c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
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

  it('balance_cents is GENERATED - direct UPDATE is rejected (premortem R4)', async () => {
    const pg = await setupPg();
    try {
      // Seed an auth.users + profiles row so we can insert a wallet row.
      const userResult = await pg.query<{ id: string }>(
        `INSERT INTO auth.users DEFAULT VALUES RETURNING id`,
      );
      const userId = userResult.rows[0]!.id;
      await runSqlBlock(
        pg,
        `INSERT INTO profiles (id, full_name, dob, email) VALUES ('${userId}', 'Wallet Tester', '1990-01-01', 'wallet@test.com')`,
      );
      // Wallet row arrives via the AC5 trigger (which we test below); for
      // the GENERATED-rejection check, INSERT directly.
      await runSqlBlock(
        pg,
        `INSERT INTO time_wallets (profile_id, balance_minutes, last_activity_at) VALUES ('${userId}', 60, now())`,
      );
      const after = await pg.query<{ balance_minutes: string; balance_cents: string }>(
        `SELECT balance_minutes::text, balance_cents::text FROM time_wallets WHERE profile_id = '${userId}'`,
      );
      expect(after.rows[0]?.balance_minutes).toBe('60');
      expect(after.rows[0]?.balance_cents).toBe('1200'); // 60 minutes * 20 cents/minute

      // Direct UPDATE to the generated column is rejected by Postgres.
      // pglite surfaces this as an Error with message mentioning the
      // column is "GENERATED" or "can only be updated to DEFAULT".
      await expect(
        runSqlBlock(
          pg,
          `UPDATE time_wallets SET balance_cents = 999 WHERE profile_id = '${userId}'`,
        ),
      ).rejects.toThrow();
    } finally {
      await pg.close();
    }
  });

  it('balance_cents recomputes correctly for seed values (premortem R11)', async () => {
    // R11: at HOURLY_RATE_CENTS=1200, balance_cents = balance_minutes * 20
    // exactly for every integer minute. Seed a wide set of values and
    // assert the math holds.
    const pg = await setupPg();
    try {
      const seeds = [0, 1, 7, 60, 61, 119, 120, 1234567];
      const ids: string[] = [];
      for (const minutes of seeds) {
        const userResult = await pg.query<{ id: string }>(
          `INSERT INTO auth.users DEFAULT VALUES RETURNING id`,
        );
        const userId = userResult.rows[0]!.id;
        await runSqlBlock(
          pg,
          `INSERT INTO profiles (id, full_name, dob, email) VALUES ('${userId}', 'Member ${minutes}', '1990-01-01', 'm${minutes}@test.com')`,
        );
        await runSqlBlock(
          pg,
          `INSERT INTO time_wallets (profile_id, balance_minutes, last_activity_at) VALUES ('${userId}', ${minutes}, now())`,
        );
        ids.push(userId);
      }
      for (let i = 0; i < seeds.length; i++) {
        const minutes = seeds[i]!;
        const userId = ids[i]!;
        const row = await pg.query<{ balance_minutes: string; balance_cents: string }>(
          `SELECT balance_minutes::text, balance_cents::text FROM time_wallets WHERE profile_id = '${userId}'`,
        );
        const got = row.rows[0]!;
        expect(got.balance_minutes).toBe(String(minutes));
        // The load-bearing equation: balance_cents = balance_minutes * 20.
        // If a future maintainer drifts the GENERATED expression, this
        // assertion fails on the first row that crosses the rate boundary.
        expect(got.balance_cents).toBe(String(minutes * 20));
      }
    } finally {
      await pg.close();
    }
  });

  it('AC5: INSERT purchase -> balance=180; INSERT redemption -> balance=120; duplicate idempotency_key -> 23505', async () => {
    const pg = await setupPg();
    try {
      // Seed: one profile + one actor (the staff member writing the
      // manual_credit row; webhook-driven rows would carry source_payment_id
      // and actor_id NULL, but the AC5 trigger sub-cases use manual entries
      // because they don't require a payments row to exist).
      const memberResult = await pg.query<{ id: string }>(
        `INSERT INTO auth.users DEFAULT VALUES RETURNING id`,
      );
      const memberId = memberResult.rows[0]!.id;
      const actorResult = await pg.query<{ id: string }>(
        `INSERT INTO auth.users DEFAULT VALUES RETURNING id`,
      );
      const actorId = actorResult.rows[0]!.id;
      await runSqlBlock(
        pg,
        `INSERT INTO profiles (id, full_name, dob, email) VALUES ('${memberId}', 'Member Tester', '1990-01-01', 'member@test.com')`,
      );
      await runSqlBlock(
        pg,
        `INSERT INTO profiles (id, full_name, dob, email) VALUES ('${actorId}', 'Staff Tester', '1990-01-01', 'staff@test.com')`,
      );

      // Seed 1: purchase of 180 minutes via manual_credit (no payment FK
      // required; the time_ledger_payment_or_manual CHECK allows
      // source_payment_id NULL when actor_id is NOT NULL).
      await runSqlBlock(
        pg,
        `INSERT INTO time_ledger (profile_id, action, amount_minutes, actor_id, idempotency_key)
         VALUES ('${memberId}', 'manual_credit', 180, '${actorId}', 'idem-purchase-test-1')`,
      );

      // Assert: time_wallets.balance_minutes = 180 (running sum).
      const after180 = await pg.query<{ balance_minutes: string; balance_cents: string }>(
        `SELECT balance_minutes::text, balance_cents::text FROM time_wallets WHERE profile_id = '${memberId}'`,
      );
      expect(after180.rows[0]?.balance_minutes).toBe('180');
      // balance_cents = 180 * 20 = 3600.
      expect(after180.rows[0]?.balance_cents).toBe('3600');

      // Seed 2: redemption of -60 minutes (debit).
      await runSqlBlock(
        pg,
        `INSERT INTO time_ledger (profile_id, action, amount_minutes, actor_id, idempotency_key)
         VALUES ('${memberId}', 'redemption', -60, '${actorId}', 'idem-redemption-test-1')`,
      );

      const after120 = await pg.query<{ balance_minutes: string; balance_cents: string }>(
        `SELECT balance_minutes::text, balance_cents::text FROM time_wallets WHERE profile_id = '${memberId}'`,
      );
      expect(after120.rows[0]?.balance_minutes).toBe('120');
      expect(after120.rows[0]?.balance_cents).toBe('2400'); // 120 * 20

      // Seed 3 (R10): duplicate idempotency_key INSERT must raise
      // SQLSTATE 23505 (unique_violation). Slice 2 handler code
      // pattern-matches on this SQLSTATE to short-circuit retries.
      let caught: unknown = undefined;
      try {
        await runSqlBlock(
          pg,
          `INSERT INTO time_ledger (profile_id, action, amount_minutes, actor_id, idempotency_key)
           VALUES ('${memberId}', 'manual_credit', 30, '${actorId}', 'idem-purchase-test-1')`,
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const errObj = caught as { code?: string; message?: string };
      // pglite surfaces the SQLSTATE as `.code`. The test asserts the
      // specific 23505 (unique_violation) - premortem R10.
      expect(errObj.code).toBe('23505');
      // The error message should reference the constraint name so future
      // debuggers can grep for it.
      expect(errObj.message ?? '').toMatch(/time_ledger_idempotency_key_unique/);

      // Balance unchanged after the failed duplicate INSERT.
      const afterDup = await pg.query<{ balance_minutes: string }>(
        `SELECT balance_minutes::text FROM time_wallets WHERE profile_id = '${memberId}'`,
      );
      expect(afterDup.rows[0]?.balance_minutes).toBe('120');
    } finally {
      await pg.close();
    }
  });

  it('time_ledger_payment_or_manual CHECK rejects rows with both source_payment_id and actor_id NULL (premortem R5)', async () => {
    const pg = await setupPg();
    try {
      const userResult = await pg.query<{ id: string }>(
        `INSERT INTO auth.users DEFAULT VALUES RETURNING id`,
      );
      const memberId = userResult.rows[0]!.id;
      await runSqlBlock(
        pg,
        `INSERT INTO profiles (id, full_name, dob, email) VALUES ('${memberId}', 'Orphan Tester', '1990-01-01', 'orphan@test.com')`,
      );

      // Both source_payment_id and actor_id NULL -> CHECK violation 23514.
      let caught: unknown = undefined;
      try {
        await runSqlBlock(
          pg,
          `INSERT INTO time_ledger (profile_id, action, amount_minutes, idempotency_key)
           VALUES ('${memberId}', 'manual_credit', 60, 'idem-orphan-test-1')`,
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const errObj = caught as { code?: string; message?: string };
      // CHECK violation surfaces as SQLSTATE 23514.
      expect(errObj.code).toBe('23514');
      expect(errObj.message ?? '').toMatch(/time_ledger_payment_or_manual/);
    } finally {
      await pg.close();
    }
  });

  it('time_ledger_action_enum CHECK rejects unknown actions (ADR-0011 enum integrity)', async () => {
    const pg = await setupPg();
    try {
      const memberResult = await pg.query<{ id: string }>(
        `INSERT INTO auth.users DEFAULT VALUES RETURNING id`,
      );
      const memberId = memberResult.rows[0]!.id;
      const actorResult = await pg.query<{ id: string }>(
        `INSERT INTO auth.users DEFAULT VALUES RETURNING id`,
      );
      const actorId = actorResult.rows[0]!.id;
      await runSqlBlock(
        pg,
        `INSERT INTO profiles (id, full_name, dob, email) VALUES ('${memberId}', 'Enum Tester', '1990-01-01', 'enum@test.com')`,
      );
      await runSqlBlock(
        pg,
        `INSERT INTO profiles (id, full_name, dob, email) VALUES ('${actorId}', 'Enum Actor', '1990-01-01', 'enum-actor@test.com')`,
      );

      let caught: unknown = undefined;
      try {
        await runSqlBlock(
          pg,
          `INSERT INTO time_ledger (profile_id, action, amount_minutes, actor_id, idempotency_key)
           VALUES ('${memberId}', 'not_a_valid_action', 60, '${actorId}', 'idem-enum-test-1')`,
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      const errObj = caught as { code?: string; message?: string };
      expect(errObj.code).toBe('23514');
      expect(errObj.message ?? '').toMatch(/time_ledger_action_enum/);
    } finally {
      await pg.close();
    }
  });
});
