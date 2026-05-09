// Migration shape test — ADR-0003 / AC9.
//
// Two fidelity tiers per the spec:
//
//   1. Regex/substring tier — surface-level lexical assertions. Catches
//      copy-paste obvious mistakes (filename pattern, missing column names,
//      missing policy/trigger names, presence of FOR INSERT).
//
//   2. AST tier — pg-query-emscripten parses the migration SQL into the
//      Postgres parse tree. Tests walk specific subtrees to assert semantic
//      properties: WHERE the policy USING/WITH CHECK clauses reference the
//      auth.uid() / auth.role_at_least(<role>) calls, the role column has
//      NOT NULL and DEFAULT 'member', the FK has ON DELETE CASCADE, etc.
//
// Why both tiers: regex catches "the policy text mentions X" but cannot
// distinguish a real reference from a SQL comment. AST tier guarantees the
// reference is in the actual policy expression. Per premortem #12, both
// tiers are required — skipping the AST tier under deadline pressure is the
// silent-failure pattern this test fights against.
//
// SQLSTATE assertions live in tests/db/rls-profiles.test.ts (t4); shape tests
// only verify structure, not runtime behavior.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PgQueryModule from 'pg-query-emscripten';

const MIGRATION_PATH = resolve(__dirname, '../../supabase/migrations/0002_profiles_and_roles.sql');
const SQL = readFileSync(MIGRATION_PATH, 'utf8');

// -----------------------------------------------------------------------------
// Tier 1 — Regex / substring assertions (AC9 lexical tier)
// -----------------------------------------------------------------------------

describe('profiles migration — regex tier (AC9 lexical assertions)', () => {
  it('filename matches NNNN_<snake_case>.sql convention', () => {
    expect(MIGRATION_PATH).toMatch(/0002_profiles_and_roles\.sql$/);
    // AC1 also requires the four-digit prefix pattern; assert standalone too.
    const filename = MIGRATION_PATH.split(/[\\/]/).pop() ?? '';
    expect(filename).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('declares role_t enum with all four lowercase values', () => {
    expect(SQL).toMatch(/CREATE TYPE\s+role_t\s+AS ENUM/i);
    for (const v of ['member', 'cashier', 'manager', 'owner']) {
      expect(SQL).toMatch(new RegExp(`'${v}'`));
    }
  });

  it('creates profiles table with all required v1 columns', () => {
    expect(SQL).toMatch(/CREATE TABLE\s+profiles/i);
    for (const col of ['id', 'full_name', 'dob', 'phone', 'email', 'role', 'created_at', 'updated_at']) {
      expect(SQL).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('enables row-level security on profiles', () => {
    expect(SQL).toMatch(/ALTER TABLE\s+profiles\s+ENABLE ROW LEVEL SECURITY/i);
  });

  it('declares the three named policies', () => {
    expect(SQL).toMatch(/CREATE POLICY\s+profiles_select_self_or_staff/);
    expect(SQL).toMatch(/CREATE POLICY\s+profiles_update_self_or_manager/);
    expect(SQL).toMatch(/CREATE POLICY\s+profiles_delete_manager/);
  });

  it('does NOT declare any FOR INSERT policy on profiles', () => {
    // Premortem #3: an "I helpfully added an insert policy" mistake bypasses
    // the deliberate service-role-only signup path. Strip line comments first
    // so a comment that mentions "FOR INSERT" doesn't trip the test.
    const noLineComments = SQL.replace(/--[^\n]*/g, '');
    // Also strip block comments (defensive — current migration uses none).
    const noBlockComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(noBlockComments).not.toMatch(/FOR\s+INSERT/i);
  });

  it('declares both trigger names; protection trigger sorts alphabetically before set_updated_at', () => {
    expect(SQL).toMatch(/CREATE TRIGGER\s+profiles_protect_role_change/);
    expect(SQL).toMatch(/CREATE TRIGGER\s+set_updated_at/);
    // Premortem #7 — fire-order invariant. Postgres fires multiple BEFORE
    // triggers on the same event in alphabetical order by name.
    expect('profiles_protect_role_change' < 'set_updated_at').toBe(true);
  });

  it('schema-qualifies role_at_least into auth (not public)', () => {
    // Premortem #11 — function in `public` makes policies error at query time.
    expect(SQL).toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+auth\.role_at_least/i);
  });

  it('keeps the DO NOT RENAME comment near each CREATE TRIGGER', () => {
    // Premortem #7 — load-bearing comment that tells future-developer not to
    // invert the alphabetical ordering. Worker-flagged in 0011-worker-t1.md.
    const matches = SQL.match(/DO NOT RENAME/gi) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// -----------------------------------------------------------------------------
// Tier 2 — AST parse-tree assertions (AC9 parser-fidelity tier)
// -----------------------------------------------------------------------------
//
// pg-query-emscripten is async-loaded via `new Module()`. We parse once in
// `beforeAll` and walk the tree with permissive helpers — libpg_query's node
// shapes vary across versions, so we search recursively for nodes by key.

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
  // The module factory is `new Module()` returning a Promise. Calling pattern
  // taken straight from pg-query-emscripten/README.md.
  // eslint-disable-next-line new-cap
  const pgQuery = await new PgQueryModule();
  const result = pgQuery.parse(SQL);
  if (result.error) {
    throw new Error(
      `pg-query-emscripten failed to parse 0002_profiles_and_roles.sql: ${result.error.message}`,
    );
  }
  parseTree = result.parse_tree as PgQueryParseTree;
});

// Helper: recursively walk the AST and collect every object that has the
// given key. Returns the value at that key for each match. Used to find all
// nodes of a particular type without committing to a specific tree path.
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
// substring. Used as a permissive fallback when we don't know the exact AST
// path to a constant or function call. Stringifying the AST then substring-
// matching is still tighter than scanning raw SQL because the AST has already
// stripped comments and normalized whitespace.
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
  // A_Const wrapping: { A_Const: { sval: { sval: 'x' } } } or similar.
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

// Helper: find the CreatePolicyStmt with the given policy name.
function findPolicy(name: string): Record<string, unknown> | null {
  const policies = collectNodes<Record<string, unknown>>(parseTree, 'CreatePolicyStmt');
  for (const p of policies) {
    if (p.policy_name === name) return p;
  }
  return null;
}

describe('profiles migration — AST tier (AC9 parser-fidelity assertions)', () => {
  it('parses without error and yields a non-empty stmts array', () => {
    expect(parseTree).toBeDefined();
    expect(Array.isArray(parseTree.stmts)).toBe(true);
    expect((parseTree.stmts ?? []).length).toBeGreaterThan(0);
  });

  // Premortem #5/#8 — enum value drift (capitalization, missing values, extra values).
  it('CreateEnumStmt declares exactly the four lowercase role_t values in order', () => {
    const enums = collectNodes<Record<string, unknown>>(parseTree, 'CreateEnumStmt');
    expect(enums).toHaveLength(1);
    const stmt = enums[0]!;
    const vals = (stmt.vals as unknown[]) ?? [];
    const valStrings = vals.map(readStringNode).filter((s): s is string => s !== null);
    expect(valStrings).toEqual(['member', 'cashier', 'manager', 'owner']);
  });

  // Premortem #9 — FK direction. Premortem also covers ON DELETE CASCADE.
  it('id column has FK to auth.users(id) with ON DELETE CASCADE', () => {
    const tables = collectNodes<Record<string, unknown>>(parseTree, 'CreateStmt');
    // There is exactly one CreateStmt in this migration (profiles).
    const profilesTable = tables.find((t) => {
      const rel = t.relation as Record<string, unknown> | undefined;
      return rel?.relname === 'profiles';
    });
    expect(profilesTable).toBeDefined();
    const tableElts = (profilesTable!.tableElts as unknown[]) ?? [];
    const idCol = tableElts
      .map((e) => (e as Record<string, unknown>).ColumnDef as Record<string, unknown> | undefined)
      .find((c) => c?.colname === 'id');
    expect(idCol).toBeDefined();
    // Walk the id column for an FK Constraint with fk_del_action 'c' (CASCADE).
    const constraints = collectNodes<Record<string, unknown>>(idCol, 'Constraint');
    const fkConstraint = constraints.find(
      (c) => c.contype === 'CONSTR_FOREIGN' || c.contype === 8 /* libpg_query enum */,
    );
    expect(fkConstraint).toBeDefined();
    // Reference table is auth.users — pktable.relname === 'users', schemaname === 'auth'.
    const pktable = fkConstraint!.pktable as Record<string, unknown> | undefined;
    expect(pktable?.relname).toBe('users');
    expect(pktable?.schemaname).toBe('auth');
    // CASCADE encodes as 'c'. Be permissive — accept either 'c' or 'CASCADE'.
    const delAction = fkConstraint!.fk_del_action;
    expect(delAction === 'c' || delAction === 'CASCADE').toBe(true);
  });

  // AC9 — role column NOT NULL DEFAULT 'member'.
  it('role column is NOT NULL with DEFAULT literal "member"', () => {
    const tables = collectNodes<Record<string, unknown>>(parseTree, 'CreateStmt');
    const profilesTable = tables.find(
      (t) => (t.relation as Record<string, unknown> | undefined)?.relname === 'profiles',
    );
    const tableElts = (profilesTable!.tableElts as unknown[]) ?? [];
    const roleCol = tableElts
      .map((e) => (e as Record<string, unknown>).ColumnDef as Record<string, unknown> | undefined)
      .find((c) => c?.colname === 'role');
    expect(roleCol).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(roleCol, 'Constraint');
    const hasNotNull = constraints.some(
      (c) => c.contype === 'CONSTR_NOTNULL' || c.contype === 1,
    );
    expect(hasNotNull).toBe(true);
    // DEFAULT 'member' — the constraint with contype CONSTR_DEFAULT carries
    // a raw_expr. Use subtreeContains as the path varies across versions.
    const defaultConstraint = constraints.find(
      (c) => c.contype === 'CONSTR_DEFAULT' || c.contype === 5,
    );
    expect(defaultConstraint).toBeDefined();
    expect(subtreeContains(defaultConstraint, 'member')).toBe(true);
  });

  // Premortem #1 — select policy must include both halves joined by OR.
  it('profiles_select_self_or_staff USING references auth.uid() AND auth.role_at_least("cashier")', () => {
    const policy = findPolicy('profiles_select_self_or_staff');
    expect(policy).toBeDefined();
    expect(policy!.cmd_name === 'select' || policy!.cmd_name === 'SELECT').toBe(true);
    const qual = policy!.qual;
    expect(qual).toBeDefined();
    expect(subtreeContains(qual, 'uid')).toBe(true);
    expect(subtreeContains(qual, 'role_at_least')).toBe(true);
    expect(subtreeContains(qual, 'cashier')).toBe(true);
  });

  // Premortem #2 — UPDATE policy MUST have both USING and WITH CHECK clauses.
  // This is the single most load-bearing AST assertion in the file.
  it('profiles_update_self_or_manager has BOTH USING (qual) and WITH CHECK (with_check) clauses', () => {
    const policy = findPolicy('profiles_update_self_or_manager');
    expect(policy).toBeDefined();
    expect(policy!.cmd_name === 'update' || policy!.cmd_name === 'UPDATE').toBe(true);

    const qual = policy!.qual;
    const withCheck = policy!.with_check;
    expect(qual).toBeDefined();
    expect(qual).not.toBeNull();
    expect(withCheck).toBeDefined();
    expect(withCheck).not.toBeNull();

    // Both clauses must reference auth.uid() and auth.role_at_least('manager').
    expect(subtreeContains(qual, 'uid')).toBe(true);
    expect(subtreeContains(qual, 'role_at_least')).toBe(true);
    expect(subtreeContains(qual, 'manager')).toBe(true);

    expect(subtreeContains(withCheck, 'uid')).toBe(true);
    expect(subtreeContains(withCheck, 'role_at_least')).toBe(true);
    expect(subtreeContains(withCheck, 'manager')).toBe(true);
  });

  // Premortem #4 — DELETE policy must be scoped to manager+, not cashier or owner-only.
  it('profiles_delete_manager USING references auth.role_at_least("manager") only', () => {
    const policy = findPolicy('profiles_delete_manager');
    expect(policy).toBeDefined();
    expect(policy!.cmd_name === 'delete' || policy!.cmd_name === 'DELETE').toBe(true);
    const qual = policy!.qual;
    expect(qual).toBeDefined();
    expect(subtreeContains(qual, 'role_at_least')).toBe(true);
    expect(subtreeContains(qual, 'manager')).toBe(true);
    // Premortem #4 guard — not cashier-scoped, not owner-only-scoped.
    expect(subtreeContains(qual, 'cashier')).toBe(false);
    expect(subtreeContains(qual, "'owner'")).toBe(false);
  });

  // Premortem #6 — protection trigger function body uses OR (not AND) joining
  // auth.role_at_least('manager') and auth.uid() IS NULL.
  it('profiles_protect_role_change function body references auth.role_at_least("manager") AND auth.uid() IS NULL bypass', () => {
    const fns = collectNodes<Record<string, unknown>>(parseTree, 'CreateFunctionStmt');
    // Find the protection function by walking its funcname list.
    const protectFn = fns.find((f) => {
      const funcname = (f.funcname as unknown[]) ?? [];
      return funcname.some((n) => readStringNode(n) === 'profiles_protect_role_change');
    });
    expect(protectFn).toBeDefined();
    // The function body lives in the `options` array as a DefElem with
    // defname 'as' carrying the plpgsql source. Easier to subtree-stringify.
    const dump = JSON.stringify(protectFn);
    expect(dump).toContain('role_at_least');
    expect(dump).toContain('manager');
    expect(dump).toContain('auth.uid()');
    expect(dump).toContain('IS NULL');
    // Premortem #6 guard — body must not be the inverted-AND variant. We
    // accept the reverse string ordering "manager') OR auth.uid() IS NULL"
    // OR "auth.uid() IS NULL OR auth.role_at_least('manager')" — the
    // operator MUST be OR. There is no AND between role_at_least and IS NULL
    // for the bypass predicate.
    // Normalize whitespace and test for the disallowed combination.
    const body = dump.replace(/\\n/g, ' ').replace(/\s+/g, ' ');
    // Disallow: auth.role_at_least('manager') AND auth.uid() IS NULL
    expect(body).not.toMatch(/role_at_least\([^)]*manager[^)]*\)\s+AND\s+auth\.uid\(\)\s+IS NULL/i);
    expect(body).not.toMatch(/auth\.uid\(\)\s+IS NULL\s+AND\s+auth\.role_at_least\([^)]*manager/i);
  });

  // Premortem #6 — trigger event/column/timing/relation must be exact.
  it('profiles_protect_role_change trigger has timing=BEFORE, events=[UPDATE], columns=["role"], on profiles', () => {
    const triggers = collectNodes<Record<string, unknown>>(parseTree, 'CreateTrigStmt');
    const protectTrig = triggers.find((t) => t.trigname === 'profiles_protect_role_change');
    expect(protectTrig).toBeDefined();

    // libpg_query bitfield constants (stable across versions 13–16):
    //   TRIGGER_TYPE_BEFORE = 1<<1 = 2
    //   TRIGGER_TYPE_AFTER  = 1<<2 = 4
    //   TRIGGER_TYPE_INSERT = 1<<2 = 4
    //   TRIGGER_TYPE_DELETE = 1<<3 = 8
    //   TRIGGER_TYPE_UPDATE = 1<<4 = 16
    //   TRIGGER_TYPE_ROW    = 1<<0 = 1
    //
    // Defensive: some libpg_query versions return separate `timing` + `events`
    // fields (current install behaviour, per validator diagnostic 0017); older
    // versions expose a single combined `tgtype` bitfield. Check whichever
    // shape the parsed AST actually returns. JSON-stringify-substring assertions
    // for keyword strings ('UPDATE'/'BEFORE') do NOT work — libpg_query emits
    // the numeric bitfield codes only.
    const timing = protectTrig!.timing;
    const events = protectTrig!.events;
    const tgtype = protectTrig!.tgtype;
    if (typeof timing === 'number') {
      expect(timing).toBe(2); // BEFORE
    }
    if (typeof events === 'number') {
      expect(events & 16).toBe(16); // UPDATE bit set
    }
    if (typeof tgtype === 'number') {
      expect(tgtype & 2).toBe(2); // BEFORE
      expect(tgtype & 16).toBe(16); // UPDATE
    }

    // Column list — must include 'role'.
    const columns = (protectTrig!.columns as unknown[]) ?? [];
    const colNames = columns.map(readStringNode).filter((s): s is string => s !== null);
    expect(colNames).toContain('role');
    // Relation must be `profiles` (not auth.users or another table — premortem #6).
    const relation = protectTrig!.relation as Record<string, unknown> | undefined;
    expect(relation?.relname).toBe('profiles');
  });

  // Premortem #11 — function must be schema-qualified into `auth`.
  it('auth.role_at_least is created in the auth schema (funcname = ["auth","role_at_least"])', () => {
    const fns = collectNodes<Record<string, unknown>>(parseTree, 'CreateFunctionStmt');
    const helper = fns.find((f) => {
      const funcname = (f.funcname as unknown[]) ?? [];
      const names = funcname.map(readStringNode).filter((s): s is string => s !== null);
      return names.length === 2 && names[0] === 'auth' && names[1] === 'role_at_least';
    });
    expect(helper).toBeDefined();
  });
});
