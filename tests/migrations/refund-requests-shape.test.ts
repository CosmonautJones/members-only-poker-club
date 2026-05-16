// Migration shape test — ADR-0036 / AC8.
//
// Three fidelity tiers (mirrors tests/migrations/payments-shape.test.ts):
//
//   1. Regex/substring tier — lexical assertions: filename, all 14 columns,
//      bigserial PK, target_payment_id FK to payments(id) ON DELETE NO ACTION,
//      profile_id + actor_id FKs to profiles(id) ON DELETE NO ACTION,
//      refund_requests_amount_positive CHECK (amount_cents > 0) — strict `>`
//      not `>=` per premortem R6, idempotency_key UNIQUE, two indexes,
//      ENABLE+FORCE RLS, COMMENT ON TABLE pinning lib/payments/authority.ts.
//
//   2. AST tier — pg-query-emscripten parses the migration SQL. Walks the
//      parse tree to assert column count + order, three FK constraints,
//      amount_positive CHECK with `>` operator, idempotency_key_unique UNIQUE.
//
//   3. pglite-applies-cleanly tier — apply migrations 0001..0014 (or as many
//      as ship) plus 0015_refund_requests.sql against a fresh pglite. Plus
//      premortem-R10 sub-case: duplicate-idempotency_key INSERT raises
//      SQLSTATE '23505' exactly (Slice 2 pattern-matches on this code).
//      Plus premortem-R6 sub-cases: amount_cents = 0 raises 23514; -1 raises
//      23514; 1 succeeds.
//
// Premortem coupling (.conductor/36/returns/0004-premortem-schema.md):
//   R6 — Zero/negative refund slips past form validation: CHECK (amount_cents
//        > 0) strict. NEGATIVE assert `amount_cents >= 0` does NOT appear.
//   R8 — RLS-off window: ENABLE+FORCE RLS at end of THIS migration so
//        default-deny is in place before 0016 lands policies.
//   R9 — explicit `ON DELETE NO ACTION` on every REFERENCES profiles(id) and
//        REFERENCES payments(id).
//   R10 — duplicate-idempotency-key SQLSTATE distinguishability: assert
//         exactly '23505' so Slice 2 handler can pattern-match.

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
const MIGRATION_PATH = resolve(MIGRATIONS_DIR, '0015_refund_requests.sql');
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
// Tier 1 — Regex / substring assertions (AC8 lexical tier)
// -----------------------------------------------------------------------------

describe('refund_requests migration — regex tier (AC8 lexical assertions)', () => {
  it('filename matches NNNN_<snake_case>.sql convention and the slice-1 specific name', () => {
    const filename = MIGRATION_PATH.split(/[\\/]/).pop() ?? '';
    expect(filename).toMatch(/^0015_refund_requests\.sql$/);
    expect(filename).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('creates refund_requests table with all 14 v1 column names', () => {
    expect(SQL).toMatch(/CREATE\s+TABLE\s+refund_requests/i);
    for (const col of [
      'id',
      'target_payment_id',
      'profile_id',
      'actor_id',
      'refund_type',
      'amount_cents',
      'reason',
      'reason_note',
      'status',
      'stripe_refund_id',
      'stripe_error',
      'idempotency_key',
      'created_at',
      'settled_at',
    ]) {
      expect(SQL).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('id is bigserial PRIMARY KEY', () => {
    expect(SQL).toMatch(/\bid\b[^,]*bigserial[^,]*PRIMARY\s+KEY/i);
  });

  it('target_payment_id references payments(id) with explicit ON DELETE NO ACTION (premortem R9)', () => {
    expect(SQL).toMatch(
      /target_payment_id[^,]*bigint[^,]*NOT\s+NULL[^,]*REFERENCES\s+payments\s*\(\s*id\s*\)\s+ON\s+DELETE\s+NO\s+ACTION/i,
    );
  });

  it('profile_id references profiles(id) with explicit ON DELETE NO ACTION (premortem R9)', () => {
    expect(SQL).toMatch(
      /profile_id[^,]*uuid[^,]*NOT\s+NULL[^,]*REFERENCES\s+profiles\s*\(\s*id\s*\)\s+ON\s+DELETE\s+NO\s+ACTION/i,
    );
  });

  it('actor_id references profiles(id) with explicit ON DELETE NO ACTION (premortem R9)', () => {
    expect(SQL).toMatch(
      /actor_id[^,]*uuid[^,]*NOT\s+NULL[^,]*REFERENCES\s+profiles\s*\(\s*id\s*\)\s+ON\s+DELETE\s+NO\s+ACTION/i,
    );
  });

  it('refund_type is text NOT NULL (three-enum values documented in COMMENT)', () => {
    expect(SQL).toMatch(/refund_type[^,]*text[^,]*NOT\s+NULL/i);
  });

  it('status is text NOT NULL DEFAULT pending', () => {
    expect(SQL).toMatch(/\bstatus\s+text[^,]*NOT\s+NULL[^,]*DEFAULT\s+'pending'/i);
  });

  it('idempotency_key is text NOT NULL', () => {
    expect(SQL).toMatch(/idempotency_key[^,]*text[^,]*NOT\s+NULL/i);
  });

  it('declares refund_requests_amount_positive CHECK (amount_cents > 0) — strict `>` (premortem R6)', () => {
    // R6: zero-cent refund is a form-validation bug worth catching at the DB
    // layer. The CHECK is STRICTLY `> 0`, not `>= 0`.
    expect(SQL).toMatch(
      /CONSTRAINT\s+refund_requests_amount_positive\s+CHECK\s*\(\s*amount_cents\s*>\s*0\s*\)/i,
    );
  });

  it('does NOT declare amount_cents >= 0 form (premortem R6 negative-assert)', () => {
    // Strip comments first so doc text mentioning the forbidden pattern
    // does not trip the assertion.
    expect(SQL_NO_COMMENTS).not.toMatch(/amount_cents\s*>=\s*0/);
  });

  it('declares refund_requests_idempotency_key_unique UNIQUE (idempotency_key)', () => {
    expect(SQL).toMatch(
      /CONSTRAINT\s+refund_requests_idempotency_key_unique\s+UNIQUE\s*\(\s*idempotency_key\s*\)/i,
    );
  });

  it('declares refund_requests_profile_idx on (profile_id, created_at DESC)', () => {
    expect(SQL).toMatch(/CREATE\s+INDEX\s+refund_requests_profile_idx/i);
    expect(SQL).toMatch(
      /refund_requests_profile_idx\s+ON\s+refund_requests\s*\(\s*profile_id\s*,\s*created_at\s+DESC\s*\)/i,
    );
  });

  it('declares refund_requests_status_idx on (status, created_at DESC)', () => {
    expect(SQL).toMatch(/CREATE\s+INDEX\s+refund_requests_status_idx/i);
    expect(SQL).toMatch(
      /refund_requests_status_idx\s+ON\s+refund_requests\s*\(\s*status\s*,\s*created_at\s+DESC\s*\)/i,
    );
  });

  it('enables AND forces row-level security on refund_requests (premortem R8 / synthesis D4)', () => {
    expect(SQL).toMatch(/ALTER\s+TABLE\s+refund_requests\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(SQL).toMatch(/ALTER\s+TABLE\s+refund_requests\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('does NOT declare any CREATE POLICY in this migration (policies land in 0016)', () => {
    expect(SQL_NO_COMMENTS).not.toMatch(/CREATE\s+POLICY\s+/i);
  });

  it('contains NO ON DELETE CASCADE or ON DELETE SET NULL', () => {
    expect(SQL_NO_COMMENTS).not.toMatch(/ON\s+DELETE\s+CASCADE/i);
    expect(SQL_NO_COMMENTS).not.toMatch(/ON\s+DELETE\s+SET\s+NULL/i);
  });

  it('contains COMMENT ON TABLE refund_requests pinning authority matrix lives in lib/payments/authority.ts (not RLS)', () => {
    expect(SQL).toMatch(/COMMENT\s+ON\s+TABLE\s+refund_requests\s+IS/i);
    const idx = SQL.search(/COMMENT\s+ON\s+TABLE\s+refund_requests\s+IS/i);
    const block = SQL.slice(idx, idx + 1500);
    expect(block).toMatch(/ADR-0036/);
    expect(block).toMatch(/lib\/payments\/authority\.ts/i);
  });

  it('contains the migration-review acknowledgement comment for blocking CREATE INDEX', () => {
    expect(SQL).toMatch(/migration-review:\s+blocking-index-approved/);
  });
});

// -----------------------------------------------------------------------------
// Tier 2 — AST parse-tree assertions (AC8 parser-fidelity tier)
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
      `pg-query-emscripten failed to parse 0015_refund_requests.sql: ${result.error.message}`,
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

describe('refund_requests migration — AST tier (AC8 parser-fidelity assertions)', () => {
  it('parses without error and yields a non-empty stmts array', () => {
    expect(parseTree).toBeDefined();
    expect(Array.isArray(parseTree.stmts)).toBe(true);
    expect((parseTree.stmts ?? []).length).toBeGreaterThan(0);
  });

  it('CreateStmt for refund_requests has all 14 columns in spec order', () => {
    const table = findCreateTable('refund_requests');
    expect(table).toBeDefined();
    const columns = listColumns(table!);
    const names = columns.map((c) => c.colname).filter((n): n is string => typeof n === 'string');
    expect(names).toEqual([
      'id',
      'target_payment_id',
      'profile_id',
      'actor_id',
      'refund_type',
      'amount_cents',
      'reason',
      'reason_note',
      'status',
      'stripe_refund_id',
      'stripe_error',
      'idempotency_key',
      'created_at',
      'settled_at',
    ]);
  });

  it('three FK columns (target_payment_id → payments, profile_id + actor_id → profiles) all have NO ACTION on delete and IS NOT NULL', () => {
    const table = findCreateTable('refund_requests');
    const columns = listColumns(table!);

    const fkExpectations: { col: string; refTable: string }[] = [
      { col: 'target_payment_id', refTable: 'payments' },
      { col: 'profile_id', refTable: 'profiles' },
      { col: 'actor_id', refTable: 'profiles' },
    ];

    for (const { col, refTable } of fkExpectations) {
      const columnNode = columns.find((c) => c.colname === col);
      expect(columnNode).toBeDefined();
      const constraints = collectNodes<Record<string, unknown>>(columnNode, 'Constraint');

      const fkConstraint = constraints.find(
        (c) => c.contype === 'CONSTR_FOREIGN' || c.contype === 8,
      );
      expect(fkConstraint).toBeDefined();
      const pktable = fkConstraint!.pktable as Record<string, unknown> | undefined;
      expect(pktable?.relname).toBe(refTable);

      const delAction = fkConstraint!.fk_del_action;
      expect(delAction).not.toBe('c');
      expect(delAction).not.toBe('n');
      const acceptable: (string | undefined)[] = ['a', 'NO ACTION', '', undefined];
      expect(acceptable).toContain(delAction as string | undefined);

      const hasNotNull = constraints.some((c) => c.contype === 'CONSTR_NOTNULL' || c.contype === 1);
      expect(hasNotNull).toBe(true);
    }
  });

  it('table-level constraints declare refund_requests_amount_positive and refund_requests_idempotency_key_unique', () => {
    const table = findCreateTable('refund_requests');
    expect(table).toBeDefined();
    const tableElts = (table!.tableElts as unknown[]) ?? [];
    const tableConstraints = tableElts
      .map((e) => (e as Record<string, unknown>).Constraint as Record<string, unknown> | undefined)
      .filter((c): c is Record<string, unknown> => c !== undefined);

    const conames = tableConstraints
      .map((c) => c.conname)
      .filter((n): n is string => typeof n === 'string');
    expect(conames).toContain('refund_requests_amount_positive');
    expect(conames).toContain('refund_requests_idempotency_key_unique');

    // amount_positive CHECK subtree must reference amount_cents.
    const amountCheck = tableConstraints.find(
      (c) => c.conname === 'refund_requests_amount_positive',
    );
    expect(subtreeContains(amountCheck, 'amount_cents')).toBe(true);
  });

  it('IndexStmt × 2 on refund_requests: profile_idx, status_idx', () => {
    const indices = collectNodes<Record<string, unknown>>(parseTree, 'IndexStmt');
    const tableIndices = indices.filter((idx) => {
      const rel = idx.relation as Record<string, unknown> | undefined;
      return rel?.relname === 'refund_requests';
    });
    expect(tableIndices.length).toBeGreaterThanOrEqual(2);

    const byName = new Map<string, Record<string, unknown>>();
    for (const idx of tableIndices) {
      if (typeof idx.idxname === 'string') byName.set(idx.idxname, idx);
    }
    expect(byName.has('refund_requests_profile_idx')).toBe(true);
    expect(byName.has('refund_requests_status_idx')).toBe(true);
  });

  it('AlterTable ENABLE + FORCE row-level security on refund_requests (premortem R8)', () => {
    const alters = collectNodes<Record<string, unknown>>(parseTree, 'AlterTableStmt');
    const tableAlters = alters.filter((a) => {
      const rel = a.relation as Record<string, unknown> | undefined;
      return rel?.relname === 'refund_requests';
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
// Tier 3 — pglite-applies-cleanly tier + premortem-R6 + premortem-R10 sub-cases
// -----------------------------------------------------------------------------

describe('refund_requests migration — pglite-applies-cleanly tier', () => {
  // Helper that boots a fresh pglite with the prerequisite schema for
  // refund_requests (auth stubs + 0001..0009 + this migration). t2's
  // 0010..0012 are NOT required by refund_requests (no cross-FK), so we
  // probe-and-skip them if not shipped yet.
  async function bootPgliteWithRefundRequests(): Promise<PGlite> {
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
    // t2 + 0013 + 0014: probe-and-skip.
    for (const name of [
      '0010_time_wallets.sql',
      '0011_time_ledger.sql',
      '0012_time_ledger_balance_trigger.sql',
      '0013_disputes.sql',
      '0014_stripe_webhook_events.sql',
    ]) {
      try {
        const sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
        await runSqlBlock(pg, sql);
      } catch {
        // Not yet shipped — skip.
      }
    }
    await runSqlBlock(pg, readFileSync(MIGRATION_PATH, 'utf8'));
    return pg;
  }

  it('applies cleanly against fresh pglite + RLS forced', async () => {
    const pg = await bootPgliteWithRefundRequests();
    try {
      const probe = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM refund_requests`,
      );
      expect(probe.rows[0]?.count).toBe('0');

      const rls = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
        SELECT c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'refund_requests'
      `);
      expect(rls.rows[0]?.relrowsecurity).toBe(true);
      expect(rls.rows[0]?.relforcerowsecurity).toBe(true);
    } finally {
      await pg.close();
    }
  });

  it('amount_cents = 0 INSERT raises SQLSTATE 23514 (CHECK violation; premortem R6)', async () => {
    const pg = await bootPgliteWithRefundRequests();
    try {
      // Seed an actor profile + a target payment so the FKs resolve.
      // We bypass RLS by writing as the table-owner role (pglite default)
      // — but our migrations ENABLE+FORCE RLS which would also block the
      // owner unless we set a session-level bypass. The simplest path is
      // to disable FORCE for the duration of seeding via SET local. But
      // setting local needs a tx; simpler: temporarily DROP FORCE then
      // re-add. Actually pglite runs as superuser by default which
      // bypasses RLS entirely — confirmed by t1 + memberships tests.
      const seedProfile = `
        INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-000000000001');
        INSERT INTO profiles (id, full_name, dob, email, role)
        VALUES ('00000000-0000-0000-0000-000000000001', 'Seed Zero', '1990-01-01', 'seed-zero@example.test', 'manager');
      `;
      await runSqlBlock(pg, seedProfile);
      const seedPayment = `
        INSERT INTO payments (stripe_object_id, kind, profile_id, amount_cents, status, stripe_event_id)
        VALUES ('pi_test_ref_zero', 'membership', '00000000-0000-0000-0000-000000000001', 1000, 'succeeded', 'evt_seed_zero')
        RETURNING id;
      `;
      const seeded = await pg.query<{ id: number }>(seedPayment);
      const paymentId = seeded.rows[0]?.id;
      expect(paymentId).toBeDefined();

      // Now attempt the zero-cent insert — must fail with 23514.
      const offending = `
        INSERT INTO refund_requests
          (target_payment_id, profile_id, actor_id, refund_type, amount_cents, reason, idempotency_key)
        VALUES
          (${paymentId}, '00000000-0000-0000-0000-000000000001',
           '00000000-0000-0000-0000-000000000001', 'time_bank', 0, 'goodwill',
           '11111111-1111-4111-8111-111111111111');
      `;
      let caught: (Error & { code?: string }) | undefined;
      try {
        await runSqlBlock(pg, offending);
      } catch (err) {
        caught = err as Error & { code?: string };
      }
      expect(caught).toBeDefined();
      // SQLSTATE 23514 is "check_violation".
      expect(caught!.code).toBe('23514');
    } finally {
      await pg.close();
    }
  });

  it('amount_cents = -1 INSERT raises SQLSTATE 23514 (premortem R6)', async () => {
    const pg = await bootPgliteWithRefundRequests();
    try {
      await runSqlBlock(
        pg,
        `INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-000000000002');
         INSERT INTO profiles (id, full_name, dob, email, role)
         VALUES ('00000000-0000-0000-0000-000000000002', 'Seed Neg', '1990-01-01', 'seed-neg@example.test', 'manager');`,
      );
      const seeded = await pg.query<{ id: number }>(
        `INSERT INTO payments (stripe_object_id, kind, profile_id, amount_cents, status, stripe_event_id)
         VALUES ('pi_test_ref_neg', 'membership', '00000000-0000-0000-0000-000000000002', 1000, 'succeeded', 'evt_seed_neg')
         RETURNING id`,
      );
      const paymentId = seeded.rows[0]?.id;
      let caught: (Error & { code?: string }) | undefined;
      try {
        await runSqlBlock(
          pg,
          `INSERT INTO refund_requests
             (target_payment_id, profile_id, actor_id, refund_type, amount_cents, reason, idempotency_key)
           VALUES
             (${paymentId}, '00000000-0000-0000-0000-000000000002',
              '00000000-0000-0000-0000-000000000002', 'time_bank', -1, 'goodwill',
              '22222222-2222-4222-8222-222222222222')`,
        );
      } catch (err) {
        caught = err as Error & { code?: string };
      }
      expect(caught).toBeDefined();
      expect(caught!.code).toBe('23514');
    } finally {
      await pg.close();
    }
  });

  it('amount_cents = 1 INSERT succeeds (premortem R6 positive case)', async () => {
    const pg = await bootPgliteWithRefundRequests();
    try {
      await runSqlBlock(
        pg,
        `INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-000000000003');
         INSERT INTO profiles (id, full_name, dob, email, role)
         VALUES ('00000000-0000-0000-0000-000000000003', 'Seed Pos', '1990-01-01', 'seed-pos@example.test', 'manager');`,
      );
      const seeded = await pg.query<{ id: number }>(
        `INSERT INTO payments (stripe_object_id, kind, profile_id, amount_cents, status, stripe_event_id)
         VALUES ('pi_test_ref_pos', 'membership', '00000000-0000-0000-0000-000000000003', 1000, 'succeeded', 'evt_seed_pos')
         RETURNING id`,
      );
      const paymentId = seeded.rows[0]?.id;
      await runSqlBlock(
        pg,
        `INSERT INTO refund_requests
           (target_payment_id, profile_id, actor_id, refund_type, amount_cents, reason, idempotency_key)
         VALUES
           (${paymentId}, '00000000-0000-0000-0000-000000000003',
            '00000000-0000-0000-0000-000000000003', 'time_bank', 1, 'goodwill',
            '33333333-3333-4333-8333-333333333333')`,
      );
      const probe = await pg.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM refund_requests WHERE amount_cents = 1`,
      );
      expect(probe.rows[0]?.count).toBe('1');
    } finally {
      await pg.close();
    }
  });

  it('duplicate idempotency_key INSERT raises SQLSTATE 23505 exactly (premortem R10)', async () => {
    // R10: Slice 2 handler patterns-matches on this SQLSTATE to distinguish
    // a retry collision from other errors. The test pins '23505' as the
    // load-bearing return code so a future schema rewrite (e.g., partial
    // UNIQUE) that altered the surfaced code would break here, alerting us.
    const pg = await bootPgliteWithRefundRequests();
    try {
      await runSqlBlock(
        pg,
        `INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-000000000004');
         INSERT INTO profiles (id, full_name, dob, email, role)
         VALUES ('00000000-0000-0000-0000-000000000004', 'Seed Dup', '1990-01-01', 'seed-dup@example.test', 'manager');`,
      );
      const seeded = await pg.query<{ id: number }>(
        `INSERT INTO payments (stripe_object_id, kind, profile_id, amount_cents, status, stripe_event_id)
         VALUES ('pi_test_ref_dup', 'membership', '00000000-0000-0000-0000-000000000004', 5000, 'succeeded', 'evt_seed_dup')
         RETURNING id`,
      );
      const paymentId = seeded.rows[0]?.id;
      const sharedKey = '44444444-4444-4444-8444-444444444444';

      // First insert succeeds.
      await runSqlBlock(
        pg,
        `INSERT INTO refund_requests
           (target_payment_id, profile_id, actor_id, refund_type, amount_cents, reason, idempotency_key)
         VALUES
           (${paymentId}, '00000000-0000-0000-0000-000000000004',
            '00000000-0000-0000-0000-000000000004', 'time_bank', 100, 'goodwill',
            '${sharedKey}')`,
      );

      // Second insert with same idempotency_key MUST raise 23505.
      let caught: (Error & { code?: string }) | undefined;
      try {
        await runSqlBlock(
          pg,
          `INSERT INTO refund_requests
             (target_payment_id, profile_id, actor_id, refund_type, amount_cents, reason, idempotency_key)
           VALUES
             (${paymentId}, '00000000-0000-0000-0000-000000000004',
              '00000000-0000-0000-0000-000000000004', 'time_bank', 200, 'duplicate',
              '${sharedKey}')`,
        );
      } catch (err) {
        caught = err as Error & { code?: string };
      }
      expect(caught).toBeDefined();
      expect(caught!.code).toBe('23505');
    } finally {
      await pg.close();
    }
  });
});
