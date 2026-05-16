// Migration shape test — ADR-0034 / AC6.
//
// Two fidelity tiers per the spec (mirrors cycle 1's profiles-shape.test.ts
// and cycle 2's audit-log-shape.test.ts):
//
//   1. Regex/lexical tier — surface-level lexical assertions. Catches
//      copy-paste obvious mistakes (filename pattern, missing column names,
//      missing policy names, presence of FOR INSERT / FOR DELETE on clubs,
//      missing seed row, NOT NULL drift on profiles.display_tz ADD COLUMN).
//      Comment-stripped first so INVARIANT comments that *mention* the
//      forbidden patterns do not trip the test.
//
//   2. AST tier — pg-query-emscripten parses the migration SQL into the
//      Postgres parse tree. Tests walk specific subtrees to assert semantic
//      properties: column count and primary-key on id, UNIQUE on slug,
//      exactly two policies for SELECT and UPDATE (no INSERT/DELETE on
//      clubs), seed INSERT carries the two string literals, profiles
//      ALTER TABLE has AT_AddColumn for display_tz text with no NOT NULL
//      constraint, and the statement-order invariant
//      (CREATE TABLE clubs → INSERT INTO clubs → ALTER TABLE profiles).
//
// Why both tiers: regex catches "the migration mentions X" but cannot
// distinguish a real reference from a SQL comment. AST tier guarantees the
// reference is in the actual SQL statement. SQLSTATE assertions live in
// tests/db/clubs-and-display-tz.test.ts (t5); shape tests only verify
// structure, not runtime behavior.
//
// Spec coupling (docs/specs/0034-timestamp-and-timezone-policy-implementation.md
// AC6):
//   * Regex tier — filename, 5 v1 columns, 'America/Chicago' default,
//     enable+force RLS, two policy names, ABSENCE of FOR INSERT / FOR DELETE
//     on clubs, ALTER TABLE profiles ADD COLUMN display_tz text, seed INSERT
//     literals, ABSENCE of NOT NULL on profiles.display_tz ALTER ADD COLUMN.
//   * AST tier — CreateStmt clubs has 5 columns; id CONSTR_PRIMARY; slug
//     CONSTR_UNIQUE; CreatePolicyStmt × 2 (select_anyone + update_manager);
//     NO INSERT/DELETE CreatePolicyStmt on clubs; InsertStmt clubs with
//     'default' and 'America/Chicago' literals; AlterTableStmt profiles with
//     AT_AddColumn display_tz text no CONSTR_NOTNULL; statement-order walk
//     (CREATE TABLE clubs precedes INSERT INTO clubs precedes ALTER TABLE
//     profiles).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PgQueryModule from 'pg-query-emscripten';

const MIGRATION_PATH = resolve(__dirname, '../../supabase/migrations/0007_clubs_and_display_tz.sql');
const SQL = readFileSync(MIGRATION_PATH, 'utf8');

// Helper: strip both line (--) and C-style block (/* */) SQL comments. Used
// by the regex tier so a comment that mentions a forbidden pattern doesn't
// trip the test (defense same as cycles 1 & 2's no-FOR-INSERT check).
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const SQL_NO_COMMENTS = stripComments(SQL);

// -----------------------------------------------------------------------------
// Tier 1 — Regex / substring assertions (AC6 lexical tier)
// -----------------------------------------------------------------------------

describe('0007_clubs_and_display_tz migration — regex tier (AC6 lexical assertions)', () => {
  it('filename matches the cycle-0034 specific name and NNNN_<snake_case>.sql convention', () => {
    const filename = MIGRATION_PATH.split(/[\\/]/).pop() ?? '';
    expect(filename).toMatch(/^0007_clubs_and_display_tz\.sql$/);
    expect(filename).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('creates clubs table with all 5 v1 column names', () => {
    expect(SQL).toMatch(/CREATE TABLE\s+clubs/i);
    for (const col of ['id', 'slug', 'display_tz', 'created_at', 'updated_at']) {
      expect(SQL).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it("uses literal 'America/Chicago' (single-quoted) as the display_tz default", () => {
    // ADR-0034 §"Schema additions" pins the default to the v1 club zone.
    // The single-quoted literal must appear verbatim — a double-quoted form
    // would be a Postgres identifier, not a string, and a different value
    // would silently retarget the v1 default.
    expect(SQL).toMatch(/'America\/Chicago'/);
  });

  it('enables AND forces row-level security on clubs', () => {
    // Same defense-in-depth posture as cycle 1's profiles and cycle 2's
    // audit_log. FORCE applies to the table owner so pglite's WASM owner
    // sees the same policy enforcement as production Supabase.
    expect(SQL).toMatch(/\benable\s+row\s+level\s+security\b/i);
    expect(SQL).toMatch(/\bforce\s+row\s+level\s+security\b/i);
  });

  it('declares both policy names', () => {
    expect(SQL).toMatch(/CREATE POLICY\s+clubs_select_anyone/);
    expect(SQL).toMatch(/CREATE POLICY\s+clubs_update_manager/);
  });

  it('does NOT declare any FOR INSERT or FOR DELETE policy on clubs (comment-stripped first)', () => {
    // ADR-0034: clubs has exactly two policies (SELECT + UPDATE). INSERT
    // goes through service-role seed (migration runner) or a future server-
    // action gate; DELETE is a destructive operation needing its own ADR.
    // Strip line `--` and block `/* */` comments first so the INVARIANT
    // comment that mentions "INSERT" / "DELETE" intent does not trip the
    // test. Restrict the scan window to the clubs-policy block (between the
    // first CREATE POLICY on clubs and the seed INSERT) — `INSERT INTO clubs`
    // for the seed must not be flagged. Defensive: walk to either the seed
    // INSERT or end-of-file, whichever is closer.
    const policyBlockStart = SQL_NO_COMMENTS.search(/CREATE POLICY\s+clubs_/);
    expect(policyBlockStart).toBeGreaterThanOrEqual(0);
    const insertSeedStart = SQL_NO_COMMENTS.search(/INSERT\s+INTO\s+clubs\b/i);
    const blockEnd = insertSeedStart > policyBlockStart ? insertSeedStart : SQL_NO_COMMENTS.length;
    const policyBlock = SQL_NO_COMMENTS.slice(policyBlockStart, blockEnd);
    expect(policyBlock).not.toMatch(/FOR\s+INSERT/i);
    expect(policyBlock).not.toMatch(/FOR\s+DELETE/i);
  });

  it('contains `ALTER TABLE profiles ADD COLUMN display_tz text` (case-insensitive)', () => {
    expect(SQL).toMatch(/ALTER\s+TABLE\s+profiles\s+ADD\s+COLUMN\s+display_tz\s+text/i);
  });

  it('contains the seed `INSERT INTO clubs` with `default` and `America/Chicago` literals', () => {
    expect(SQL).toMatch(/INSERT\s+INTO\s+clubs\b/i);
    // Both literals appear in the same INSERT VALUES list. Scope the check
    // to the INSERT statement to avoid accidentally matching a comment.
    const insertIdx = SQL_NO_COMMENTS.search(/INSERT\s+INTO\s+clubs\b/i);
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    const stmtEnd = SQL_NO_COMMENTS.indexOf(';', insertIdx);
    const stmt = SQL_NO_COMMENTS.slice(insertIdx, stmtEnd > 0 ? stmtEnd : SQL_NO_COMMENTS.length);
    expect(stmt).toMatch(/'default'/);
    expect(stmt).toMatch(/'America\/Chicago'/);
  });

  it('does NOT declare `not null` on the profiles.display_tz ADD COLUMN line', () => {
    // ADR-0034: profiles.display_tz is NULLABLE — NULL means "inherit
    // clubs.display_tz". A worker who "helpfully" tightens to NOT NULL with
    // a default silently re-introduces the auto-detection ADR-0034 forbids
    // AND breaks ADR-0023's del:<hash> anonymization (which sets the column
    // to NULL). Strip comments first so the INVARIANT comment that mentions
    // "NOT NULL" intent does not trip the test. Scope: the ALTER TABLE
    // profiles statement only — clubs.display_tz IS NOT NULL is legitimate
    // and must not be flagged.
    const alterIdx = SQL_NO_COMMENTS.search(
      /ALTER\s+TABLE\s+profiles\s+ADD\s+COLUMN\s+display_tz\b/i,
    );
    expect(alterIdx).toBeGreaterThanOrEqual(0);
    const stmtEnd = SQL_NO_COMMENTS.indexOf(';', alterIdx);
    const stmt = SQL_NO_COMMENTS.slice(alterIdx, stmtEnd > 0 ? stmtEnd : SQL_NO_COMMENTS.length);
    expect(stmt).not.toMatch(/\bnot\s+null\b/i);
  });
});

// -----------------------------------------------------------------------------
// Tier 2 — AST parse-tree assertions (AC6 parser-fidelity tier)
// -----------------------------------------------------------------------------
//
// pg-query-emscripten is async-loaded via `new Module()`. We parse once in
// `beforeAll` and walk the tree with permissive helpers — libpg_query's node
// shapes vary across versions, so we search recursively for nodes by key.
// The helper functions below mirror cycle 1's profiles-shape.test.ts and
// cycle 2's audit-log-shape.test.ts patterns.

interface PgQueryStmt {
  RawStmt?: { stmt?: Record<string, unknown>; stmt_location?: number };
  [key: string]: unknown;
}

interface PgQueryParseTree {
  version?: number;
  stmts?: PgQueryStmt[];
}

let parseTree: PgQueryParseTree;

beforeAll(async () => {
  // The module factory is `new Module()` returning a Promise. Calling
  // pattern taken straight from pg-query-emscripten/README.md and matches
  // cycle 1 / cycle 2's invocation shape.
  // eslint-disable-next-line new-cap
  const pgQuery = await new PgQueryModule();
  const result = pgQuery.parse(SQL);
  if (result.error) {
    throw new Error(
      `pg-query-emscripten failed to parse 0007_clubs_and_display_tz.sql: ${result.error.message}`,
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

// Helper: stringify a subtree and check whether it textually contains a
// substring. Permissive fallback when we don't know the exact AST path to a
// constant. Stringifying then substring-matching is still tighter than
// scanning raw SQL because the AST has stripped comments and normalized
// whitespace.
function subtreeContains(node: unknown, needle: string): boolean {
  return JSON.stringify(node).includes(needle);
}

// Helper: find the CreateStmt for a table by relname.
function findCreateTable(relname: string): Record<string, unknown> | undefined {
  const tables = collectNodes<Record<string, unknown>>(parseTree, 'CreateStmt');
  return tables.find((t) => {
    const rel = t.relation as Record<string, unknown> | undefined;
    return rel?.relname === relname;
  });
}

// Helper: list ColumnDef objects from a CreateStmt's tableElts. tableElts
// is a mixed array containing ColumnDef and Constraint entries; this helper
// returns only the ColumnDef rows.
function listColumns(table: Record<string, unknown>): Record<string, unknown>[] {
  const tableElts = (table.tableElts as unknown[]) ?? [];
  return tableElts
    .map((e) => (e as Record<string, unknown>).ColumnDef as Record<string, unknown> | undefined)
    .filter((c): c is Record<string, unknown> => c !== undefined);
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

// Helper: find InsertStmt nodes targeting a given relation name. InsertStmt
// has a `relation` RangeVar like CreateStmt does.
function findInsertStmts(relname: string): Record<string, unknown>[] {
  const inserts = collectNodes<Record<string, unknown>>(parseTree, 'InsertStmt');
  return inserts.filter((i) => {
    const rel = i.relation as Record<string, unknown> | undefined;
    return rel?.relname === relname;
  });
}

// Helper: find AlterTableStmt nodes targeting a given relation name.
function findAlterTableStmts(relname: string): Record<string, unknown>[] {
  const alters = collectNodes<Record<string, unknown>>(parseTree, 'AlterTableStmt');
  return alters.filter((a) => {
    const rel = a.relation as Record<string, unknown> | undefined;
    return rel?.relname === relname;
  });
}

describe('0007_clubs_and_display_tz migration — AST tier (AC6 parser-fidelity assertions)', () => {
  it('parses without error and yields a non-empty stmts array', () => {
    expect(parseTree).toBeDefined();
    expect(Array.isArray(parseTree.stmts)).toBe(true);
    expect((parseTree.stmts ?? []).length).toBeGreaterThan(0);
  });

  // AC6 — exactly 5 columns on clubs in v1.
  it('CreateStmt for clubs has exactly 5 columns matching v1 spec', () => {
    const table = findCreateTable('clubs');
    expect(table).toBeDefined();
    const columns = listColumns(table!);
    expect(columns).toHaveLength(5);
    const names = columns.map((c) => c.colname).filter((n): n is string => typeof n === 'string');
    // Order matters per AC5.1 (verbatim from ADR-0034).
    expect(names).toEqual(['id', 'slug', 'display_tz', 'created_at', 'updated_at']);
  });

  // AC6 — id has CONSTR_PRIMARY constraint.
  it('id column has a CONSTR_PRIMARY constraint', () => {
    const table = findCreateTable('clubs');
    const columns = listColumns(table!);
    const idCol = columns.find((c) => c.colname === 'id');
    expect(idCol).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(idCol, 'Constraint');
    // libpg_query enum: CONSTR_PRIMARY string form OR numeric (varies by
    // version). Match cycle-2's mixed-mode acceptance.
    const hasPrimary = constraints.some(
      (c) => c.contype === 'CONSTR_PRIMARY' || c.contype === 5 || c.contype === 6,
    );
    if (!hasPrimary) {
      // Defensive: some libpg_query versions emit different numeric codes
      // for CONSTR_PRIMARY. Fall back to subtree-substring on
      // 'CONSTR_PRIMARY' as a last resort.
      expect(subtreeContains(idCol, 'CONSTR_PRIMARY')).toBe(true);
    } else {
      expect(hasPrimary).toBe(true);
    }
  });

  // AC6 — slug has CONSTR_UNIQUE constraint.
  it('slug column has a CONSTR_UNIQUE constraint', () => {
    const table = findCreateTable('clubs');
    const columns = listColumns(table!);
    const slugCol = columns.find((c) => c.colname === 'slug');
    expect(slugCol).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(slugCol, 'Constraint');
    // libpg_query enum: CONSTR_UNIQUE varies by version (commonly 4 or 7).
    // Mixed-mode acceptance: string form, common numeric forms, or subtree
    // substring fallback.
    const hasUnique = constraints.some(
      (c) =>
        c.contype === 'CONSTR_UNIQUE' || c.contype === 4 || c.contype === 7 || c.contype === 8,
    );
    if (!hasUnique) {
      expect(subtreeContains(slugCol, 'CONSTR_UNIQUE')).toBe(true);
    } else {
      expect(hasUnique).toBe(true);
    }
  });

  // AC6 — exactly two policies on clubs (SELECT + UPDATE). NO INSERT, NO
  // DELETE policy.
  it('CreatePolicyStmt × 2 for clubs: exactly select_anyone + update_manager, no insert/delete', () => {
    const policies = findPoliciesOnTable('clubs');
    expect(policies).toHaveLength(2);

    const byName = new Map<string, Record<string, unknown>>();
    for (const p of policies) {
      if (typeof p.policy_name === 'string') byName.set(p.policy_name, p);
    }

    const selectPolicy = byName.get('clubs_select_anyone');
    const updatePolicy = byName.get('clubs_update_manager');
    expect(selectPolicy).toBeDefined();
    expect(updatePolicy).toBeDefined();

    // cmd_name pinning — accept either lowercase or uppercase form.
    expect(['select', 'SELECT']).toContain(selectPolicy!.cmd_name);
    expect(['update', 'UPDATE']).toContain(updatePolicy!.cmd_name);

    // ADR-0034 invariant — NO insert or delete policies on clubs.
    const insertPolicies = policies.filter(
      (p) => p.cmd_name === 'insert' || p.cmd_name === 'INSERT',
    );
    const deletePolicies = policies.filter(
      (p) => p.cmd_name === 'delete' || p.cmd_name === 'DELETE',
    );
    expect(insertPolicies).toHaveLength(0);
    expect(deletePolicies).toHaveLength(0);
  });

  // AC6 — seed InsertStmt on clubs carries 'default' and 'America/Chicago'.
  it('InsertStmt for clubs carries `default` and `America/Chicago` string literals', () => {
    const inserts = findInsertStmts('clubs');
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    // Stringify the whole InsertStmt subtree and look for the string-node
    // values. libpg_query's String/A_Const node varies (sval / str / nested
    // sval.sval) across versions; the substring search is permissive across
    // all shapes since JSON.stringify dumps every form.
    const seedInsert = inserts[0]!;
    expect(subtreeContains(seedInsert, 'default')).toBe(true);
    expect(subtreeContains(seedInsert, 'America/Chicago')).toBe(true);

    // Tighter check: collect string-literal values from the InsertStmt
    // subtree. libpg_query 5.x emits VALUES list items as A_Const nodes
    // shaped `{ A_Const: { sval: { sval: 'default' } } }` (nested) while
    // older versions emitted `{ String: { sval: 'default' } }` or
    // `{ String: { str: 'default' } }`. Walk every node and accept any
    // of those shapes — the load-bearing property is that the two literals
    // appear among the collected string values, NOT the specific node key.
    const literals: string[] = [];
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      const obj = node as Record<string, unknown>;
      // Recognized shapes carrying a string literal:
      //   { String: { sval: 'x' } } / { String: { str: 'x' } }
      //   { A_Const: { sval: { sval: 'x' } } } / { A_Const: { val: { String: { sval: 'x' } } } }
      const stringWrap = obj.String as Record<string, unknown> | undefined;
      if (stringWrap) {
        if (typeof stringWrap.sval === 'string') literals.push(stringWrap.sval);
        if (typeof stringWrap.str === 'string') literals.push(stringWrap.str);
      }
      const aConst = obj.A_Const as Record<string, unknown> | undefined;
      if (aConst) {
        const sval = aConst.sval as Record<string, unknown> | string | undefined;
        if (typeof sval === 'string') literals.push(sval);
        else if (sval && typeof sval === 'object' && typeof sval.sval === 'string') {
          literals.push(sval.sval);
        }
      }
      for (const value of Object.values(obj)) walk(value);
    };
    walk(seedInsert);

    expect(literals).toContain('default');
    expect(literals).toContain('America/Chicago');
  });

  // AC6 — AlterTableStmt for profiles with AT_AddColumn targeting display_tz
  // text and NO CONSTR_NOTNULL constraint on the new column. Defends against
  // a worker tightening to NOT NULL with a default that silently re-
  // introduces the auto-detection ADR-0034 forbids AND breaks ADR-0023's
  // del:<hash> anonymization path.
  it('AlterTableStmt for profiles has AT_AddColumn display_tz text with no CONSTR_NOTNULL', () => {
    const alters = findAlterTableStmts('profiles');
    expect(alters.length).toBeGreaterThanOrEqual(1);

    // Find the specific AlterTableStmt that adds the display_tz column.
    // An AlterTableStmt carries a `cmds` array of AlterTableCmd entries;
    // each has a `subtype` indicating the operation (AT_AddColumn etc.) and
    // a `def` carrying a ColumnDef for the new column.
    type AlterCmd = {
      AlterTableCmd?: {
        subtype?: string | number;
        def?: { ColumnDef?: Record<string, unknown> } | Record<string, unknown>;
      };
    };

    let foundAddColumn = false;
    let displayTzColDef: Record<string, unknown> | undefined;

    for (const alter of alters) {
      const cmds = (alter.cmds as AlterCmd[] | undefined) ?? [];
      for (const wrapped of cmds) {
        const cmd = wrapped.AlterTableCmd;
        if (!cmd) continue;
        // libpg_query: AT_AddColumn is the string form on modern versions;
        // numeric form on older versions varies. Accept both shapes.
        const isAddColumn =
          cmd.subtype === 'AT_AddColumn' ||
          cmd.subtype === 0 ||
          cmd.subtype === 1 ||
          subtreeContains(cmd, 'AT_AddColumn');
        if (!isAddColumn) continue;
        const def = cmd.def as { ColumnDef?: Record<string, unknown> } | undefined;
        const colDef = (def?.ColumnDef ?? def) as Record<string, unknown> | undefined;
        if (colDef?.colname === 'display_tz') {
          foundAddColumn = true;
          displayTzColDef = colDef;
          break;
        }
      }
      if (foundAddColumn) break;
    }

    expect(foundAddColumn).toBe(true);
    expect(displayTzColDef).toBeDefined();

    // Type is `text` — drill into typeName.names and look for the 'text'
    // string. libpg_query 5.x emits ColumnDef.typeName as a DIRECT field
    // (not wrapped in `{ TypeName: ... }`); older versions sometimes
    // wrapped it. Accept both shapes by probing the direct field first,
    // then falling back to the wrapped form via collectNodes.
    const typeNameDirect = displayTzColDef!.typeName as
      | { names?: unknown[] }
      | { TypeName?: { names?: unknown[] } }
      | undefined;
    let typeNamesList: unknown[] | undefined;
    if (typeNameDirect) {
      if ('TypeName' in typeNameDirect && typeNameDirect.TypeName) {
        typeNamesList = typeNameDirect.TypeName.names;
      } else if ('names' in typeNameDirect) {
        typeNamesList = typeNameDirect.names;
      }
    }
    if (!typeNamesList) {
      // Final fallback: any TypeName subtree anywhere under the ColumnDef.
      const typeNameNodes = collectNodes<Record<string, unknown>>(displayTzColDef, 'TypeName');
      if (typeNameNodes.length > 0) {
        typeNamesList = typeNameNodes[0]!.names as unknown[] | undefined;
      }
    }
    expect(typeNamesList).toBeDefined();
    const typeStrings = collectNodes<Record<string, unknown>>(typeNamesList, 'String')
      .map((s) => {
        if (typeof s.sval === 'string') return s.sval;
        if (typeof s.str === 'string') return s.str;
        return null;
      })
      .filter((v): v is string => v !== null);
    expect(typeStrings).toContain('text');

    // NO CONSTR_NOTNULL on the new column. This is the load-bearing AC6
    // assertion — a worker who "helpfully" tightens to NOT NULL with a
    // default silently re-introduces the auto-detection ADR-0034 forbids.
    // libpg_query 5.x emits the explicit NULL marker as CONSTR_NULL (a
    // distinct contype from CONSTR_NOTNULL); the migration uses `NULL` so
    // the resulting constraint list contains CONSTR_NULL and MUST NOT
    // contain CONSTR_NOTNULL.
    const constraints = collectNodes<Record<string, unknown>>(displayTzColDef, 'Constraint');
    const hasNotNull = constraints.some(
      (c) => c.contype === 'CONSTR_NOTNULL' || c.contype === 1 || c.contype === 2,
    );
    expect(hasNotNull).toBe(false);
  });

  // AC6 — statement-order assertion. Walk the parsed statement list and
  // confirm CREATE TABLE clubs precedes INSERT INTO clubs which precedes
  // ALTER TABLE profiles. Catches a worker who consolidated statements in a
  // way that breaks rollback order (e.g., INSERT before CREATE — would not
  // parse at all, but the assertion is cheap insurance) or who swapped the
  // ALTER TABLE profiles to before the INSERT (would not parse but would
  // semantically misrepresent the intent).
  it('statement order: CREATE TABLE clubs precedes INSERT INTO clubs precedes ALTER TABLE profiles', () => {
    const stmts = parseTree.stmts ?? [];
    let createClubsIdx = -1;
    let insertClubsIdx = -1;
    let alterProfilesIdx = -1;

    stmts.forEach((wrapper, idx) => {
      // libpg_query 5.x emits each top-level statement as
      // `{ stmt: { CreateStmt | InsertStmt | AlterTableStmt | ...: {...} },
      //   stmt_location, stmt_len }`. Earlier versions wrapped via
      // `RawStmt`. Probe both shapes — the `stmt` field is the load-bearing
      // discriminator.
      const inner = ((wrapper as { stmt?: Record<string, unknown> }).stmt ??
        (wrapper as { RawStmt?: { stmt?: Record<string, unknown> } }).RawStmt?.stmt ??
        wrapper) as Record<string, unknown>;

      const createStmt = inner.CreateStmt as Record<string, unknown> | undefined;
      if (createStmt) {
        const rel = createStmt.relation as Record<string, unknown> | undefined;
        if (rel?.relname === 'clubs' && createClubsIdx === -1) {
          createClubsIdx = idx;
        }
      }

      const insertStmt = inner.InsertStmt as Record<string, unknown> | undefined;
      if (insertStmt) {
        const rel = insertStmt.relation as Record<string, unknown> | undefined;
        if (rel?.relname === 'clubs' && insertClubsIdx === -1) {
          insertClubsIdx = idx;
        }
      }

      const alterStmt = inner.AlterTableStmt as Record<string, unknown> | undefined;
      if (alterStmt) {
        const rel = alterStmt.relation as Record<string, unknown> | undefined;
        // Skip the ENABLE/FORCE RLS AlterTableStmts on clubs — we only care
        // about the ADD COLUMN on profiles for ordering. Multiple
        // AlterTableStmts may target profiles in theory; take the first.
        if (rel?.relname === 'profiles' && alterProfilesIdx === -1) {
          alterProfilesIdx = idx;
        }
      }
    });

    expect(createClubsIdx).toBeGreaterThanOrEqual(0);
    expect(insertClubsIdx).toBeGreaterThanOrEqual(0);
    expect(alterProfilesIdx).toBeGreaterThanOrEqual(0);

    // The load-bearing ordering: CREATE before INSERT before ALTER profiles.
    expect(createClubsIdx).toBeLessThan(insertClubsIdx);
    expect(insertClubsIdx).toBeLessThan(alterProfilesIdx);
  });
});
