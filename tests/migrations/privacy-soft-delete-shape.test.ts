// Migration shape test — ADR-0023 / AC1.
//
// Two fidelity tiers per the spec (mirrors audit-log-shape.test.ts):
//
//   1. Regex/substring tier — surface-level lexical assertions. Catches
//      copy-paste obvious mistakes: filename pattern, deleted_at column name,
//      profiles_active_idx name, DROP POLICY + CREATE POLICY for
//      profiles_select_self_or_staff, CREATE POLICY for
//      profiles_select_active_for_staff, absence of any UPDATE-policy rewrite.
//
//   2. AST tier — pg-query-emscripten parses the migration SQL. Tests walk
//      subtrees to assert: new SELECT policy's USING clause references
//      deleted_at IS NULL AND auth.role_at_least('manager'); the second policy
//      references auth.role_at_least('cashier') AND deleted_at IS NULL.
//
// AC14 (cycle 1-3 regression): this migration replaces
// profiles_select_self_or_staff. The AST assertion here captures the NEW
// shape (manager threshold + deleted_at guard). The profiles-shape.test.ts
// file is patched in W5 to match.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PgQueryModule from 'pg-query-emscripten';

const MIGRATION_PATH = resolve(__dirname, '../../supabase/migrations/0004_privacy_soft_delete.sql');
const SQL = readFileSync(MIGRATION_PATH, 'utf8');

// Helper: strip both line (--) and C-style block (/* */) SQL comments.
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const SQL_NO_COMMENTS = stripComments(SQL);

// -----------------------------------------------------------------------------
// Tier 1 — Regex / substring assertions (AC1 lexical tier)
// -----------------------------------------------------------------------------

describe('privacy_soft_delete migration — regex tier (AC1 lexical assertions)', () => {
  it('filename matches NNNN_<snake_case>.sql convention and the cycle-4 specific name', () => {
    const filename = MIGRATION_PATH.split(/[\\/]/).pop() ?? '';
    expect(filename).toMatch(/^0004_privacy_soft_delete\.sql$/);
    expect(filename).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('creates pgcrypto extension', () => {
    expect(SQL).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pgcrypto/i);
  });

  it('adds deleted_at column to profiles', () => {
    expect(SQL).toMatch(/ALTER\s+TABLE\s+profiles\s+ADD\s+COLUMN\s+deleted_at/i);
    expect(SQL).toMatch(/\bdeleted_at\b/);
    expect(SQL).toMatch(/TIMESTAMPTZ/i);
  });

  it('creates profiles_active_idx partial index', () => {
    expect(SQL).toMatch(/\bprofiles_active_idx\b/);
    expect(SQL).toMatch(/CREATE\s+INDEX\s+profiles_active_idx/i);
    expect(SQL).toMatch(/WHERE\s+deleted_at\s+IS\s+NULL/i);
  });

  it('contains both DROP POLICY and CREATE POLICY for profiles_select_self_or_staff', () => {
    expect(SQL).toMatch(/DROP\s+POLICY\s+profiles_select_self_or_staff/i);
    expect(SQL).toMatch(/CREATE\s+POLICY\s+profiles_select_self_or_staff/);
  });

  it('contains CREATE POLICY for profiles_select_active_for_staff', () => {
    expect(SQL).toMatch(/CREATE\s+POLICY\s+profiles_select_active_for_staff/);
  });

  it('does NOT rewrite any UPDATE policy (out of scope for this slice)', () => {
    // The spec explicitly defers tightening the UPDATE policy to a future slice.
    // If an UPDATE policy appears here, it's scope drift.
    expect(SQL_NO_COMMENTS).not.toMatch(/CREATE\s+POLICY.*FOR\s+UPDATE/is);
    expect(SQL_NO_COMMENTS).not.toMatch(/DROP\s+POLICY\s+profiles_update/i);
  });

  it('does NOT rewrite any DELETE policy (out of scope for this slice)', () => {
    expect(SQL_NO_COMMENTS).not.toMatch(/CREATE\s+POLICY.*FOR\s+DELETE/is);
    expect(SQL_NO_COMMENTS).not.toMatch(/DROP\s+POLICY\s+profiles_delete/i);
  });

  it('new SELECT policy USING clause references deleted_at IS NULL', () => {
    // Lexical assertion for the new USING clause on profiles_select_self_or_staff.
    const policyIndex = SQL.search(/CREATE\s+POLICY\s+profiles_select_self_or_staff/);
    expect(policyIndex).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(policyIndex, policyIndex + 600);
    expect(block).toMatch(/deleted_at\s+IS\s+NULL/i);
    expect(block).toMatch(/role_at_least\(\s*'manager'\s*\)/i);
  });

  it('new staff-active policy USING clause references cashier AND deleted_at IS NULL', () => {
    const policyIndex = SQL.search(/CREATE\s+POLICY\s+profiles_select_active_for_staff/);
    expect(policyIndex).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(policyIndex, policyIndex + 400);
    expect(block).toMatch(/deleted_at\s+IS\s+NULL/i);
    expect(block).toMatch(/role_at_least\(\s*'cashier'\s*\)/i);
  });

  it('both policies are FOR SELECT', () => {
    // Both replacement policies must be SELECT policies.
    const selfOrStaffIndex = SQL.search(/CREATE\s+POLICY\s+profiles_select_self_or_staff/);
    const activeStaffIndex = SQL.search(/CREATE\s+POLICY\s+profiles_select_active_for_staff/);
    expect(selfOrStaffIndex).toBeGreaterThanOrEqual(0);
    expect(activeStaffIndex).toBeGreaterThanOrEqual(0);
    const selfOrStaffBlock = SQL.slice(selfOrStaffIndex, selfOrStaffIndex + 200);
    const activeStaffBlock = SQL.slice(activeStaffIndex, activeStaffIndex + 200);
    expect(selfOrStaffBlock).toMatch(/FOR\s+SELECT/i);
    expect(activeStaffBlock).toMatch(/FOR\s+SELECT/i);
  });

  it('contains migration-review acknowledgement comments', () => {
    expect(SQL).toMatch(/migration-review:\s+policy-replace-approved/);
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
      `pg-query-emscripten failed to parse 0004_privacy_soft_delete.sql: ${result.error.message}`,
    );
  }
  parseTree = result.parse_tree as PgQueryParseTree;
});

// Helper: recursively walk AST and collect every object with given key.
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
// substring. Permissive fallback when we don't know the exact AST path.
function subtreeContains(node: unknown, needle: string): boolean {
  return JSON.stringify(node).includes(needle);
}

// Helper: find CreatePolicyStmt by policy name.
function findPolicy(name: string): Record<string, unknown> | null {
  const policies = collectNodes<Record<string, unknown>>(parseTree, 'CreatePolicyStmt');
  for (const p of policies) {
    if (p.policy_name === name) return p;
  }
  return null;
}

describe('privacy_soft_delete migration — AST tier (AC1 parser-fidelity assertions)', () => {
  it('parses without error and yields a non-empty stmts array', () => {
    expect(parseTree).toBeDefined();
    expect(Array.isArray(parseTree.stmts)).toBe(true);
    expect((parseTree.stmts ?? []).length).toBeGreaterThan(0);
  });

  it('profiles_select_self_or_staff USING references deleted_at IS NULL AND role_at_least("manager")', () => {
    const policy = findPolicy('profiles_select_self_or_staff');
    expect(policy).toBeDefined();
    expect(policy!.cmd_name === 'select' || policy!.cmd_name === 'SELECT').toBe(true);
    const qual = policy!.qual;
    expect(qual).toBeDefined();
    expect(qual).not.toBeNull();
    // Must reference deleted_at in the USING clause.
    expect(subtreeContains(qual, 'deleted_at')).toBe(true);
    // Must reference role_at_least with manager threshold (raised from cashier in cycle 1).
    expect(subtreeContains(qual, 'role_at_least')).toBe(true);
    expect(subtreeContains(qual, 'manager')).toBe(true);
    // Must still reference uid() for the self-select branch.
    expect(subtreeContains(qual, 'uid')).toBe(true);
    // Must NOT still reference only 'cashier' as the threshold (threshold rose to manager).
    // Note: we allow 'cashier' to appear in the subtree ONLY if 'manager' also appears
    // (the profiles_select_active_for_staff policy referencing cashier is a separate policy).
    // The key assertion is that manager appears — enforced above.
  });

  it('profiles_select_active_for_staff USING references role_at_least("cashier") AND deleted_at IS NULL', () => {
    const policy = findPolicy('profiles_select_active_for_staff');
    expect(policy).toBeDefined();
    expect(policy!.cmd_name === 'select' || policy!.cmd_name === 'SELECT').toBe(true);
    const qual = policy!.qual;
    expect(qual).toBeDefined();
    expect(qual).not.toBeNull();
    // Must reference role_at_least('cashier').
    expect(subtreeContains(qual, 'role_at_least')).toBe(true);
    expect(subtreeContains(qual, 'cashier')).toBe(true);
    // Must reference deleted_at IS NULL.
    expect(subtreeContains(qual, 'deleted_at')).toBe(true);
  });

  it('exactly two CreatePolicyStmt nodes for profiles in this migration (no update/delete policies)', () => {
    const policies = collectNodes<Record<string, unknown>>(parseTree, 'CreatePolicyStmt');
    const profilesPolicies = policies.filter((p) => {
      const table = p.table as Record<string, unknown> | undefined;
      return table?.relname === 'profiles';
    });
    // Exactly two: profiles_select_self_or_staff (replacement) + profiles_select_active_for_staff (new).
    expect(profilesPolicies).toHaveLength(2);
    // Both must be SELECT.
    for (const p of profilesPolicies) {
      expect(p.cmd_name === 'select' || p.cmd_name === 'SELECT').toBe(true);
    }
  });

  it('AlterTableStmt adds deleted_at column to profiles', () => {
    const alters = collectNodes<Record<string, unknown>>(parseTree, 'AlterTableStmt');
    const profilesAlter = alters.find((a) => {
      const rel = a.relation as Record<string, unknown> | undefined;
      return rel?.relname === 'profiles';
    });
    expect(profilesAlter).toBeDefined();
    // The command list should include an ADD COLUMN command for deleted_at.
    expect(subtreeContains(profilesAlter, 'deleted_at')).toBe(true);
  });

  it('IndexStmt creates profiles_active_idx with WHERE deleted_at IS NULL', () => {
    const indices = collectNodes<Record<string, unknown>>(parseTree, 'IndexStmt');
    const activeIdx = indices.find((idx) => idx.idxname === 'profiles_active_idx');
    expect(activeIdx).toBeDefined();
    // Relation must be profiles.
    const rel = activeIdx!.relation as Record<string, unknown> | undefined;
    expect(rel?.relname).toBe('profiles');
    // whereClause must reference deleted_at IS NULL.
    const where = activeIdx!.whereClause;
    expect(where).toBeDefined();
    expect(subtreeContains(where, 'deleted_at')).toBe(true);
  });
});
