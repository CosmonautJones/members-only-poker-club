// Migration shape test — ADR-0006 / AC8.
//
// Two fidelity tiers per the spec (mirrors cycle 1's profiles-shape.test.ts):
//
//   1. Regex/substring tier — surface-level lexical assertions. Catches
//      copy-paste obvious mistakes (filename pattern, missing column names,
//      missing index/policy names, presence of FOR UPDATE / FOR DELETE
//      policies, presence of DROP FUNCTION, presence of CREATE TRIGGER ON
//      audit_log, ON DELETE CASCADE / SET NULL drift on the actor_id FK).
//
//   2. AST tier — pg-query-emscripten parses the migration SQL into the
//      Postgres parse tree. Tests walk specific subtrees to assert semantic
//      properties: column count and primary-key on id, FK shape on actor_id
//      (auth.users with default fk_del_action = 'a' NO ACTION, NOT NULL
//      absent), index column lists with DESC ordering on created_at,
//      exactly two policies for SELECT and INSERT (no UPDATE/DELETE), the
//      profiles_protect_role_change function body retains the unauthorized
//      RAISE EXCEPTION 42501 branch verbatim and is NOT marked
//      SECURITY DEFINER (premortem #7).
//
// Why both tiers: regex catches "the policy text mentions X" but cannot
// distinguish a real reference from a SQL comment. AST tier guarantees the
// reference is in the actual policy expression. SQLSTATE assertions live in
// tests/db/audit-log.test.ts (t4); shape tests only verify structure, not
// runtime behavior.
//
// Premortem coupling (.conductor/0006/dispatches/0006-premortem-t1.md, R1–R7):
//   R1 — append-only erosion → no FOR UPDATE / FOR DELETE policy on audit_log
//   R2 — unauthorized branch preserved verbatim → AST assertion on the
//        function body containing the exact 'role change requires manager+'
//        + '42501' strings
//   R3 — actor_id stays NULLABLE → AST assertion that no CONSTR_NOTNULL
//        constraint is attached to the actor_id column
//   R4 — actor_id FK CASCADE drift → AST assertion fk_del_action default 'a'
//        (NO ACTION); regex assertion the migration text contains neither
//        `on delete cascade` nor `on delete set null`
//   R5 — DROP FUNCTION CASCADE silently drops trigger → regex assertion
//        the migration text contains no `DROP FUNCTION` whatsoever
//   R6 — circular trigger dependency → regex assertion no
//        `CREATE TRIGGER ... ON audit_log` in the migration
//   R7 — SECURITY DEFINER drift on profiles_protect_role_change → AST
//        assertion is_secdef is false on THIS function (auth.role_at_least
//        IS legitimately SECURITY DEFINER and must NOT be flagged)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PgQueryModule from 'pg-query-emscripten';

const MIGRATION_PATH = resolve(__dirname, '../../supabase/migrations/0003_audit_log.sql');
const SQL = readFileSync(MIGRATION_PATH, 'utf8');

// Helper: strip both line (--) and C-style block (/* */) SQL comments. Used
// by the regex tier so a comment that mentions a forbidden pattern doesn't
// trip the test (defense same as cycle 1's no-FOR-INSERT check).
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const SQL_NO_COMMENTS = stripComments(SQL);

// -----------------------------------------------------------------------------
// Tier 1 — Regex / substring assertions (AC8 lexical tier)
// -----------------------------------------------------------------------------

describe('audit_log migration — regex tier (AC8 lexical assertions)', () => {
  it('filename matches NNNN_<snake_case>.sql convention and the cycle-2 specific name', () => {
    const filename = MIGRATION_PATH.split(/[\\/]/).pop() ?? '';
    expect(filename).toMatch(/^0003_audit_log\.sql$/);
    expect(filename).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('creates audit_log table with all 10 v1 column names', () => {
    expect(SQL).toMatch(/CREATE TABLE\s+audit_log/i);
    for (const col of [
      'id',
      'actor_id',
      'action',
      'target_type',
      'target_id',
      'before',
      'after',
      'ip',
      'user_agent',
      'created_at',
    ]) {
      expect(SQL).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('id column uses bigserial (NOT bigint generated …)', () => {
    // ADR-0006 specifies `bigserial` verbatim. Guards against a worker
    // modernizing to `bigint generated always as identity` (the test would
    // need updating in the same change — Out of Scope for this slice).
    expect(SQL).toMatch(/\bbigserial\b/i);
  });

  it('declares all three index names', () => {
    expect(SQL).toMatch(/\baudit_log_actor_idx\b/);
    expect(SQL).toMatch(/\baudit_log_target_idx\b/);
    expect(SQL).toMatch(/\baudit_log_action_idx\b/);
  });

  it('enables AND forces row-level security on audit_log', () => {
    expect(SQL).toMatch(/\benable\s+row\s+level\s+security\b/i);
    expect(SQL).toMatch(/\bforce\s+row\s+level\s+security\b/i);
  });

  it('declares both policy names', () => {
    expect(SQL).toMatch(/CREATE POLICY\s+audit_log_select_manager/);
    expect(SQL).toMatch(/CREATE POLICY\s+audit_log_insert_authenticated/);
  });

  it('audit_log_insert_authenticated WITH CHECK contains literal `auth.uid() is not null`', () => {
    // AC8 hardened-regex tier — cheap first defense against a worker
    // silently weakening the WITH CHECK clause to `(true)` or adding an
    // `OR auth.uid() IS NULL` disjunct. AST tier covers the same property
    // with higher fidelity below; this regex catches obvious tampering
    // before the parser even runs. Whitespace-tolerant, case-insensitive.
    //
    // Strategy: locate the audit_log_insert_authenticated policy block,
    // then assert the literal predicate appears within ~400 chars of the
    // policy name (covers the FOR INSERT line + WITH CHECK clause).
    const policyIndex = SQL.search(/CREATE POLICY\s+audit_log_insert_authenticated/);
    expect(policyIndex).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(policyIndex, policyIndex + 400);
    expect(block).toMatch(/auth\.uid\(\)\s+is\s+not\s+null/i);
  });

  it('does NOT declare any FOR UPDATE or FOR DELETE policy on audit_log (premortem R1)', () => {
    // Append-only invariant: the only escape hatch is service-role BYPASSRLS,
    // not policy weakening. Strip comments first so an INVARIANT comment
    // that mentions "UPDATE or DELETE policies" doesn't trip the test.
    expect(SQL_NO_COMMENTS).not.toMatch(/FOR\s+UPDATE/i);
    expect(SQL_NO_COMMENTS).not.toMatch(/FOR\s+DELETE/i);
  });

  it('declares CREATE OR REPLACE FUNCTION profiles_protect_role_change and INSERT INTO audit_log', () => {
    expect(SQL).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+profiles_protect_role_change/i);
    expect(SQL).toMatch(/INSERT\s+INTO\s+audit_log\b/i);
  });

  it('contains NO `DROP FUNCTION` statement (premortem R5)', () => {
    // R5: DROP FUNCTION ... CASCADE would silently drop the cycle-1
    // trigger. The cycle-2 migration is purely additive; no legitimate
    // reason for it to drop anything. Strip comments first so the
    // load-bearing "DO NOT switch to DROP+CREATE" comment doesn't trip
    // the test.
    expect(SQL_NO_COMMENTS).not.toMatch(/\bDROP\s+FUNCTION\b/i);
  });

  it('contains NO `CREATE TRIGGER profiles_protect_role_change` (trigger lives in 0002)', () => {
    // The trigger declaration stays in cycle 1's migration; CREATE OR
    // REPLACE FUNCTION preserves the OID so the existing trigger keeps
    // pointing at the new body. Re-issuing CREATE TRIGGER would either
    // fail or — worse — silently shadow the cycle-1 trigger.
    expect(SQL_NO_COMMENTS).not.toMatch(/CREATE\s+TRIGGER\s+profiles_protect_role_change/i);
  });

  it('contains NO `CREATE TRIGGER ... ON audit_log` (premortem R6)', () => {
    // R6: audit_log is structurally trigger-free — see the INVARIANT
    // comment in the migration. Triggers create circular-dependency risk
    // with profiles. Append-only is enforced at the policy layer, not
    // via triggers.
    expect(SQL_NO_COMMENTS).not.toMatch(/CREATE\s+TRIGGER[\s\S]*?\bON\s+audit_log\b/i);
  });

  it('contains NO `on delete cascade` or `on delete set null` (premortem R4)', () => {
    // R4: actor_id FK MUST NOT have ON DELETE CASCADE (privacy-law
    // violation per ADR-0023 — audit rows survive account deletion). The
    // migration also intentionally omits ON DELETE SET NULL — cycle 6
    // (ADR-0023) decides that. Strip comments first so the load-bearing
    // INVARIANT comment that *mentions* these forbidden clauses doesn't
    // trip the test.
    expect(SQL_NO_COMMENTS).not.toMatch(/on\s+delete\s+cascade/i);
    expect(SQL_NO_COMMENTS).not.toMatch(/on\s+delete\s+set\s+null/i);
  });
});

// -----------------------------------------------------------------------------
// Tier 2 — AST parse-tree assertions (AC8 parser-fidelity tier)
// -----------------------------------------------------------------------------
//
// pg-query-emscripten is async-loaded via `new Module()`. We parse once in
// `beforeAll` and walk the tree with permissive helpers — libpg_query's node
// shapes vary across versions, so we search recursively for nodes by key.
// The helper functions below mirror cycle 1's profiles-shape.test.ts pattern.

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
  // The module factory is `new Module()` returning a Promise. Calling
  // pattern taken straight from pg-query-emscripten/README.md.
  // eslint-disable-next-line new-cap
  const pgQuery = await new PgQueryModule();
  const result = pgQuery.parse(SQL);
  if (result.error) {
    throw new Error(
      `pg-query-emscripten failed to parse 0003_audit_log.sql: ${result.error.message}`,
    );
  }
  parseTree = result.parse_tree as PgQueryParseTree;
});

// Helper: recursively walk the AST and collect every object that has the
// given key. Returns the value at that key for each match.
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

// Helper: stringify a subtree and check whether it textually contains a
// substring. Permissive fallback when we don't know the exact AST path to a
// constant or function call. Stringifying then substring-matching is still
// tighter than scanning raw SQL because the AST has stripped comments and
// normalized whitespace.
function subtreeContains(node: unknown, needle: string): boolean {
  return JSON.stringify(node).includes(needle);
}

// Helper: extract the string value from a pg_query String/A_Const node. The
// node shape varies — sometimes `{ String: { sval: 'x' } }`, sometimes
// `{ String: { str: 'x' } }`, depending on libpg_query version.
function readStringNode(node: unknown): string | null {
  if (node === null || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  const inner = (obj.String ?? obj.A_Const ?? obj) as Record<string, unknown>;
  if (typeof inner.sval === 'string') return inner.sval;
  if (typeof inner.str === 'string') return inner.str;
  if (inner.sval && typeof inner.sval === 'object') {
    const s = (inner.sval as Record<string, unknown>).sval;
    if (typeof s === 'string') return s;
  }
  if (inner.val && typeof inner.val === 'object') {
    const v = inner.val as Record<string, unknown>;
    if (typeof v.sval === 'string') return v.sval;
    if (typeof v.str === 'string') return v.str;
  }
  return null;
}

// Helper: find the CreatePolicyStmt(s) for a given relation name. Policies
// carry a `table` field (RangeVar) whose `relname` is the target table.
function findPoliciesOnTable(relname: string): Record<string, unknown>[] {
  const policies = collectNodes<Record<string, unknown>>(parseTree, 'CreatePolicyStmt');
  return policies.filter((p) => {
    const table = p.table as Record<string, unknown> | undefined;
    return table?.relname === relname;
  });
}

// Helper: find the CreateStmt for a table by relname.
function findCreateTable(relname: string): Record<string, unknown> | undefined {
  const tables = collectNodes<Record<string, unknown>>(parseTree, 'CreateStmt');
  return tables.find((t) => {
    const rel = t.relation as Record<string, unknown> | undefined;
    return rel?.relname === relname;
  });
}

// Helper: list ColumnDef objects from a CreateStmt's tableElts.
function listColumns(table: Record<string, unknown>): Record<string, unknown>[] {
  const tableElts = (table.tableElts as unknown[]) ?? [];
  return tableElts
    .map((e) => (e as Record<string, unknown>).ColumnDef as Record<string, unknown> | undefined)
    .filter((c): c is Record<string, unknown> => c !== undefined);
}

describe('audit_log migration — AST tier (AC8 parser-fidelity assertions)', () => {
  it('parses without error and yields a non-empty stmts array', () => {
    expect(parseTree).toBeDefined();
    expect(Array.isArray(parseTree.stmts)).toBe(true);
    expect((parseTree.stmts ?? []).length).toBeGreaterThan(0);
  });

  // AC8 — exactly 10 columns on audit_log.
  it('CreateStmt for audit_log has exactly 10 columns matching v1 spec', () => {
    const table = findCreateTable('audit_log');
    expect(table).toBeDefined();
    const columns = listColumns(table!);
    expect(columns).toHaveLength(10);
    const names = columns.map((c) => c.colname).filter((n): n is string => typeof n === 'string');
    // Order matters per AC2 (verbatim from ADR-0006).
    expect(names).toEqual([
      'id',
      'actor_id',
      'action',
      'target_type',
      'target_id',
      'before',
      'after',
      'ip',
      'user_agent',
      'created_at',
    ]);
  });

  // AC8 — id has CONSTR_PRIMARY constraint.
  it('id column has a CONSTR_PRIMARY constraint', () => {
    const table = findCreateTable('audit_log');
    const columns = listColumns(table!);
    const idCol = columns.find((c) => c.colname === 'id');
    expect(idCol).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(idCol, 'Constraint');
    // libpg_query enum: CONSTR_PRIMARY string form OR numeric (varies by version).
    const hasPrimary = constraints.some(
      (c) => c.contype === 'CONSTR_PRIMARY' || c.contype === 5 || c.contype === 6,
    );
    // Defensive: some libpg_query versions emit different numeric codes for
    // CONSTR_PRIMARY. Fall back to subtree-substring on 'PRIMARY' as a last
    // resort — the column has a primary-key constraint somewhere.
    if (!hasPrimary) {
      expect(subtreeContains(idCol, 'CONSTR_PRIMARY')).toBe(true);
    } else {
      expect(hasPrimary).toBe(true);
    }
  });

  // AC8 + premortem R3 — actor_id stays NULLABLE (no CONSTR_NOTNULL).
  // AC8 + premortem R4 — actor_id FK to auth.users, default fk_del_action 'a' (NO ACTION).
  it('actor_id has FK to auth.users with NO ACTION on delete and is NOT NULL-free', () => {
    const table = findCreateTable('audit_log');
    const columns = listColumns(table!);
    const actorCol = columns.find((c) => c.colname === 'actor_id');
    expect(actorCol).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(actorCol, 'Constraint');

    // No CONSTR_NOTNULL constraint on actor_id (premortem R3).
    const hasNotNull = constraints.some((c) => c.contype === 'CONSTR_NOTNULL' || c.contype === 1);
    expect(hasNotNull).toBe(false);

    // FK Constraint references auth.users.
    const fkConstraint = constraints.find((c) => c.contype === 'CONSTR_FOREIGN' || c.contype === 8);
    expect(fkConstraint).toBeDefined();
    const pktable = fkConstraint!.pktable as Record<string, unknown> | undefined;
    expect(pktable?.relname).toBe('users');
    expect(pktable?.schemaname).toBe('auth');

    // fk_del_action MUST be the default 'a' (NO ACTION). Reject 'c' (CASCADE)
    // and 'n' (SET NULL) — premortem R4. libpg_query may emit the field as
    // an empty string or omit it when the SQL had no explicit ON DELETE
    // clause; treat absence/empty as default-NO-ACTION (acceptable).
    const delAction = fkConstraint!.fk_del_action;
    expect(delAction).not.toBe('c');
    expect(delAction).not.toBe('CASCADE');
    expect(delAction).not.toBe('n');
    expect(delAction).not.toBe('SET NULL');
    // Positive: must be 'a', 'NO ACTION', empty string, or undefined.
    const acceptableDefaults: (string | undefined)[] = ['a', 'NO ACTION', '', undefined];
    expect(acceptableDefaults).toContain(delAction as string | undefined);
  });

  // AC8 — three IndexStmts with the right names, columns, and DESC ordering
  // on the trailing created_at element.
  it('IndexStmt × 3 with expected names, columns, and DESC on trailing created_at', () => {
    const indices = collectNodes<Record<string, unknown>>(parseTree, 'IndexStmt');
    // Filter to indices on audit_log only.
    const auditIndices = indices.filter((idx) => {
      const rel = idx.relation as Record<string, unknown> | undefined;
      return rel?.relname === 'audit_log';
    });
    expect(auditIndices).toHaveLength(3);

    const byName = new Map<string, Record<string, unknown>>();
    for (const idx of auditIndices) {
      if (typeof idx.idxname === 'string') byName.set(idx.idxname, idx);
    }
    expect(byName.has('audit_log_actor_idx')).toBe(true);
    expect(byName.has('audit_log_target_idx')).toBe(true);
    expect(byName.has('audit_log_action_idx')).toBe(true);

    // Helper: extract IndexElem column names from an IndexStmt's
    // indexParams array. Each IndexElem has a `name` field (the column).
    const elemsOf = (idx: Record<string, unknown>): Record<string, unknown>[] => {
      const params = (idx.indexParams as unknown[]) ?? [];
      return params
        .map((p) => (p as Record<string, unknown>).IndexElem as Record<string, unknown> | undefined)
        .filter((e): e is Record<string, unknown> => e !== undefined);
    };

    const actor = byName.get('audit_log_actor_idx')!;
    const target = byName.get('audit_log_target_idx')!;
    const action = byName.get('audit_log_action_idx')!;

    const actorElems = elemsOf(actor);
    const targetElems = elemsOf(target);
    const actionElems = elemsOf(action);

    expect(actorElems.map((e) => e.name)).toEqual(['actor_id', 'created_at']);
    expect(targetElems.map((e) => e.name)).toEqual(['target_type', 'target_id', 'created_at']);
    expect(actionElems.map((e) => e.name)).toEqual(['action', 'created_at']);

    // DESC ordering on the trailing created_at element. Per the cycle-1 KB
    // pglite lesson — pg-query-emscripten emits IndexElem.ordering as a
    // numeric enum (NOT a string keyword), so we use bitfield/equality
    // checks rather than JSON-stringify-substring on 'DESC'. libpg_query
    // SortByDir enum: SORTBY_DEFAULT=0, SORTBY_ASC=1, SORTBY_DESC=2,
    // SORTBY_USING=3. Some versions also emit the symbolic string form
    // 'SORTBY_DESC' — accept either.
    const lastOf = (elems: Record<string, unknown>[]): Record<string, unknown> =>
      elems[elems.length - 1]!;
    const isDesc = (elem: Record<string, unknown>): boolean => {
      const ord = elem.ordering;
      return ord === 2 || ord === 'SORTBY_DESC';
    };
    expect(isDesc(lastOf(actorElems))).toBe(true);
    expect(isDesc(lastOf(targetElems))).toBe(true);
    expect(isDesc(lastOf(actionElems))).toBe(true);
  });

  // AC8 — exactly two policies for audit_log (SELECT + INSERT). NO UPDATE,
  // NO DELETE policy. Append-only invariant (premortem R1).
  it('CreatePolicyStmt × 2 for audit_log: exactly select + insert, no update/delete', () => {
    const policies = findPoliciesOnTable('audit_log');
    expect(policies).toHaveLength(2);

    const byName = new Map<string, Record<string, unknown>>();
    for (const p of policies) {
      if (typeof p.policy_name === 'string') byName.set(p.policy_name, p);
    }

    const selectPolicy = byName.get('audit_log_select_manager');
    const insertPolicy = byName.get('audit_log_insert_authenticated');
    expect(selectPolicy).toBeDefined();
    expect(insertPolicy).toBeDefined();

    // cmd_name pinning — accept either lowercase or uppercase.
    expect(['select', 'SELECT']).toContain(selectPolicy!.cmd_name);
    expect(['insert', 'INSERT']).toContain(insertPolicy!.cmd_name);

    // SELECT policy USING references auth.role_at_least('manager').
    const selectQual = selectPolicy!.qual;
    expect(selectQual).toBeDefined();
    expect(subtreeContains(selectQual, 'role_at_least')).toBe(true);
    expect(subtreeContains(selectQual, 'manager')).toBe(true);

    // INSERT policy WITH CHECK references auth.uid() (and structurally an
    // IS NOT NULL test — we assert via subtree the function-call appears,
    // and the regex tier above pins the literal predicate text).
    const insertCheck = insertPolicy!.with_check;
    expect(insertCheck).toBeDefined();
    expect(insertCheck).not.toBeNull();
    expect(subtreeContains(insertCheck, 'uid')).toBe(true);

    // Premortem R1 — NO update or delete policies on audit_log.
    const updatePolicies = policies.filter(
      (p) => p.cmd_name === 'update' || p.cmd_name === 'UPDATE',
    );
    const deletePolicies = policies.filter(
      (p) => p.cmd_name === 'delete' || p.cmd_name === 'DELETE',
    );
    expect(updatePolicies).toHaveLength(0);
    expect(deletePolicies).toHaveLength(0);
  });

  // AC8 + premortem R2 — profiles_protect_role_change function body retains
  // the audit-write columns AND the verbatim unauthorized RAISE EXCEPTION
  // 42501 branch from cycle 1.
  it('profiles_protect_role_change function body contains audit INSERT and the verbatim 42501 unauthorized branch', () => {
    const fns = collectNodes<Record<string, unknown>>(parseTree, 'CreateFunctionStmt');
    const protectFn = fns.find((f) => {
      const funcname = (f.funcname as unknown[]) ?? [];
      return funcname.some((n) => readStringNode(n) === 'profiles_protect_role_change');
    });
    expect(protectFn).toBeDefined();

    // The function body lives in the `options` array as a DefElem with
    // defname 'as' carrying the plpgsql source. Easier to subtree-stringify
    // and substring-match, since the plpgsql body is opaque to the SQL
    // parser (libpg_query stores it as a literal string).
    const dump = JSON.stringify(protectFn);

    // Audit-write branch.
    expect(dump).toContain('INSERT INTO audit_log');
    expect(dump).toContain('profile.role_change');
    expect(dump).toContain("'profile'");
    expect(dump).toContain('auth.uid()');
    expect(dump).toContain('OLD.role');
    expect(dump).toContain('NEW.role');
    expect(dump).toContain('jsonb_build_object');

    // Unauthorized branch — premortem R2: byte-for-byte preserved from
    // cycle 1. Asserts both the message string and the SQLSTATE literal.
    expect(dump).toContain('RAISE EXCEPTION');
    expect(dump).toContain('role change requires manager+');
    expect(dump).toContain('42501');

    // Premortem R7 — this function MUST NOT be SECURITY DEFINER. libpg_query
    // emits is_secdef as a boolean (false when omitted, true when set).
    // Note: cycle-1's auth.role_at_least IS SECURITY DEFINER and MUST NOT
    // be flagged here — we check is_secdef on profiles_protect_role_change
    // specifically, not globally.
    expect(protectFn!.is_secdef === true).toBe(false);
  });

  // AC8 + premortem R5 — NO CreateTrigStmt with trigname='profiles_protect_role_change'
  // in this migration. The trigger lives in cycle 1's 0002 migration.
  it('NO CreateTrigStmt with trigname=profiles_protect_role_change in this migration', () => {
    const triggers = collectNodes<Record<string, unknown>>(parseTree, 'CreateTrigStmt');
    const protectTrig = triggers.find((t) => t.trigname === 'profiles_protect_role_change');
    expect(protectTrig).toBeUndefined();
  });

  // Premortem R6 — NO CreateTrigStmt referencing audit_log as the relation.
  // Append-only is structural; triggers create circular-dependency risk.
  it('NO CreateTrigStmt with relation referencing audit_log', () => {
    const triggers = collectNodes<Record<string, unknown>>(parseTree, 'CreateTrigStmt');
    const auditTriggers = triggers.filter((t) => {
      const relation = t.relation as Record<string, unknown> | undefined;
      return relation?.relname === 'audit_log';
    });
    expect(auditTriggers).toHaveLength(0);
  });
});
