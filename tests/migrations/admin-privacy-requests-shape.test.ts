// Migration shape test — ADR-0035 / AC1, AC3.
//
// Two fidelity tiers per the spec (mirrors audit-log-shape.test.ts):
//
//   1. Regex/substring tier — surface-level lexical assertions. Catches
//      copy-paste obvious mistakes: filename pattern, both enum types,
//      table columns, three policy names, sequence creation, both comments,
//      absence of any DELETE policy, absence of any UPDATE/DELETE-policy
//      drift on the table.
//
//   2. AST tier — pg-query-emscripten parses the migration SQL. Tests walk
//      subtrees to assert: the three CreatePolicyStmt nodes attach to
//      privacy_requests with the right cmd_name (select / insert / update);
//      USING clauses contain the expected predicates (auth.uid() reference,
//      role_at_least('manager')); NO policy with cmd_name='delete' exists;
//      AlterTable ENABLE+FORCE RLS commands are present.
//
// Premortem coupling (.conductor/0035/dispatches/0006-premortem-task.md):
//   R6 — member_number_seq must exist as a CreateSeqStmt in this migration
//        so AC12 nextval is the default path (avoids the MAX+1 race).
//   R7 — requester_email column-level COMMENT is the structural redaction
//        contract for future workers. Asserted via regex + AST CommentStmt
//        subtree match.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PgQueryModule from 'pg-query-emscripten';

const MIGRATION_PATH = resolve(__dirname, '../../supabase/migrations/0005_privacy_requests.sql');
const SQL = readFileSync(MIGRATION_PATH, 'utf8');

// Helper: strip both line (--) and C-style block (/* */) SQL comments. Used
// by the regex tier so a comment that mentions a forbidden pattern doesn't
// trip the test (defense same as audit-log-shape.test.ts).
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const SQL_NO_COMMENTS = stripComments(SQL);

// -----------------------------------------------------------------------------
// Tier 1 — Regex / substring assertions (AC1 lexical tier)
// -----------------------------------------------------------------------------

describe('privacy_requests migration — regex tier (AC1 lexical assertions)', () => {
  it('filename matches NNNN_<snake_case>.sql convention and the slice-4 specific name', () => {
    const filename = MIGRATION_PATH.split(/[\\/]/).pop() ?? '';
    expect(filename).toMatch(/^0005_privacy_requests\.sql$/);
    expect(filename).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('declares both ENUM types verbatim', () => {
    // The ENUM names are load-bearing — the privacy_requests columns and
    // future migrations reference them by name.
    expect(SQL).toMatch(
      /CREATE\s+TYPE\s+privacy_request_kind_t\s+AS\s+ENUM\s*\(\s*'export'\s*,\s*'delete'\s*\)/i,
    );
    expect(SQL).toMatch(/CREATE\s+TYPE\s+privacy_request_status_t\s+AS\s+ENUM/i);
    // All four status values must be present in order.
    const statusEnumIndex = SQL.search(/CREATE\s+TYPE\s+privacy_request_status_t/i);
    expect(statusEnumIndex).toBeGreaterThanOrEqual(0);
    const statusBlock = SQL.slice(statusEnumIndex, statusEnumIndex + 400);
    expect(statusBlock).toMatch(/'pending'/);
    expect(statusBlock).toMatch(/'in_progress'/);
    expect(statusBlock).toMatch(/'completed'/);
    expect(statusBlock).toMatch(/'rejected'/);
  });

  it('creates privacy_requests table with all 10 column names', () => {
    expect(SQL).toMatch(/CREATE\s+TABLE\s+privacy_requests/i);
    for (const col of [
      'id',
      'profile_id',
      'requester_email',
      'kind',
      'status',
      'submitted_at',
      'resolved_at',
      'resolved_by',
      'reject_reason',
      'export_url',
    ]) {
      expect(SQL).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('id column uses UUID PRIMARY KEY DEFAULT gen_random_uuid()', () => {
    // Verbatim from ADR-0035 §Data Model Deltas. Guards against a worker
    // switching to bigserial / bigint identity (the audit_log convention),
    // which would break the URL-safe-id contract this table inherits from
    // ADR-0023's deletion-request flow.
    expect(SQL).toMatch(/\bid\b[^,]*UUID[^,]*PRIMARY\s+KEY[^,]*gen_random_uuid\(\)/i);
  });

  it('profile_id references profiles(id) with ON DELETE NO ACTION', () => {
    // Premortem-adjacent: cascading delete would erase audit-equivalent
    // trail when softDeleteProfile fires. NO ACTION (default) is correct.
    expect(SQL).toMatch(/profile_id[^,]*REFERENCES\s+profiles\s*\(\s*id\s*\)/i);
    // Substring-tolerant: "ON DELETE NO ACTION" OR no clause at all
    // (both default to NO ACTION).
    const profileIdBlock = SQL.slice(
      SQL.search(/\bprofile_id\b/),
      SQL.search(/\bprofile_id\b/) + 200,
    );
    expect(profileIdBlock).not.toMatch(/ON\s+DELETE\s+CASCADE/i);
    expect(profileIdBlock).not.toMatch(/ON\s+DELETE\s+SET\s+NULL/i);
  });

  it('resolved_by references auth.users(id) with ON DELETE NO ACTION (not CASCADE)', () => {
    expect(SQL).toMatch(/resolved_by[^,]*REFERENCES\s+auth\.users\s*\(\s*id\s*\)/i);
    const resolvedByIndex = SQL.search(/\bresolved_by\b/);
    expect(resolvedByIndex).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(resolvedByIndex, resolvedByIndex + 200);
    expect(block).not.toMatch(/ON\s+DELETE\s+CASCADE/i);
    expect(block).not.toMatch(/ON\s+DELETE\s+SET\s+NULL/i);
  });

  it('enables AND forces row-level security on privacy_requests', () => {
    expect(SQL).toMatch(/ALTER\s+TABLE\s+privacy_requests\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(SQL).toMatch(/ALTER\s+TABLE\s+privacy_requests\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('declares all three policy names verbatim', () => {
    // The names are load-bearing — RLS contract tests (tests/db/rls-privacy-requests.test.ts)
    // grep for them.
    expect(SQL).toMatch(/CREATE\s+POLICY\s+privacy_requests_select_self_or_manager/);
    expect(SQL).toMatch(/CREATE\s+POLICY\s+privacy_requests_insert_self/);
    expect(SQL).toMatch(/CREATE\s+POLICY\s+privacy_requests_update_manager/);
  });

  it('select policy USING references profile_id = auth.uid() OR role_at_least(manager)', () => {
    const policyIndex = SQL.search(/CREATE\s+POLICY\s+privacy_requests_select_self_or_manager/);
    expect(policyIndex).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(policyIndex, policyIndex + 400);
    expect(block).toMatch(/FOR\s+SELECT/i);
    expect(block).toMatch(/profile_id\s*=\s*auth\.uid\(\)/i);
    expect(block).toMatch(/auth\.role_at_least\(\s*'manager'\s*\)/i);
  });

  it('insert policy WITH CHECK references profile_id = auth.uid()', () => {
    const policyIndex = SQL.search(/CREATE\s+POLICY\s+privacy_requests_insert_self/);
    expect(policyIndex).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(policyIndex, policyIndex + 400);
    expect(block).toMatch(/FOR\s+INSERT/i);
    expect(block).toMatch(/WITH\s+CHECK/i);
    expect(block).toMatch(/profile_id\s*=\s*auth\.uid\(\)/i);
  });

  it('update policy USING + WITH CHECK both reference role_at_least(manager)', () => {
    const policyIndex = SQL.search(/CREATE\s+POLICY\s+privacy_requests_update_manager/);
    expect(policyIndex).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(policyIndex, policyIndex + 500);
    expect(block).toMatch(/FOR\s+UPDATE/i);
    expect(block).toMatch(/USING\s*\(/i);
    expect(block).toMatch(/WITH\s+CHECK\s*\(/i);
    // role_at_least('manager') must appear at least twice — once in USING,
    // once in WITH CHECK.
    const matches = block.match(/auth\.role_at_least\(\s*'manager'\s*\)/gi) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT declare any FOR DELETE policy on privacy_requests (AC1 invariant)', () => {
    // Comments mention "NO DELETE policy" intentionally — strip comments
    // first so the documentation doesn't trip the test.
    expect(SQL_NO_COMMENTS).not.toMatch(/FOR\s+DELETE/i);
    expect(SQL_NO_COMMENTS).not.toMatch(/CREATE\s+POLICY\s+privacy_requests_delete/i);
  });

  it('creates privacy_requests_status_idx on (status, submitted_at)', () => {
    expect(SQL).toMatch(/CREATE\s+INDEX\s+privacy_requests_status_idx/i);
    expect(SQL).toMatch(
      /privacy_requests_status_idx\s+ON\s+privacy_requests\s*\(\s*status\s*,\s*submitted_at\s*\)/i,
    );
  });

  it('creates member_number_seq sequence (premortem R6 mitigation)', () => {
    // Per .conductor/0035/dispatches/0006-premortem-task.md R6: the sequence
    // must exist at migration time so AC12's nextval() path is the default.
    expect(SQL).toMatch(/CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?member_number_seq/i);
    expect(SQL).toMatch(/START\s+WITH\s+1000/i);
  });

  it('contains COMMENT ON TABLE privacy_requests documenting ADR-0035 ownership', () => {
    expect(SQL).toMatch(/COMMENT\s+ON\s+TABLE\s+privacy_requests\s+IS/i);
    // Must reference ADR-0035 somewhere in the comment body.
    const commentIndex = SQL.search(/COMMENT\s+ON\s+TABLE\s+privacy_requests\s+IS/i);
    expect(commentIndex).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(commentIndex, commentIndex + 1200);
    expect(block).toMatch(/ADR-0035/);
  });

  it('contains COMMENT ON COLUMN privacy_requests.requester_email per premortem R7', () => {
    // The premortem R7 mitigation pins this comment as the structural
    // contract for future workers (CSV exports, audit-log mirroring, etc.).
    expect(SQL).toMatch(/COMMENT\s+ON\s+COLUMN\s+privacy_requests\.requester_email\s+IS/i);
    const commentIndex = SQL.search(
      /COMMENT\s+ON\s+COLUMN\s+privacy_requests\.requester_email\s+IS/i,
    );
    expect(commentIndex).toBeGreaterThanOrEqual(0);
    const block = SQL.slice(commentIndex, commentIndex + 600);
    // The R7 mitigation specifies the literal phrase "pre-anonymization".
    expect(block).toMatch(/pre-anonymization/i);
    // And the export/log/audit prohibition.
    expect(block).toMatch(/MUST\s+NOT\s+be\s+exported/i);
  });

  it('contains NO ON DELETE CASCADE or ON DELETE SET NULL anywhere (privacy-trail invariant)', () => {
    // privacy_requests is audit-equivalent: neither FK should cascade or
    // null on parent delete. Strip comments first so doc references to
    // these clauses don't trip the test.
    expect(SQL_NO_COMMENTS).not.toMatch(/ON\s+DELETE\s+CASCADE/i);
    expect(SQL_NO_COMMENTS).not.toMatch(/ON\s+DELETE\s+SET\s+NULL/i);
  });

  it('contains the migration-review acknowledgement comment for the blocking index', () => {
    // The composite index on a fresh-empty table is safe but the scanner
    // cannot distinguish that from a hot-table index — explicit ack required.
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
      `pg-query-emscripten failed to parse 0005_privacy_requests.sql: ${result.error.message}`,
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

describe('privacy_requests migration — AST tier (AC1 parser-fidelity assertions)', () => {
  it('parses without error and yields a non-empty stmts array', () => {
    expect(parseTree).toBeDefined();
    expect(Array.isArray(parseTree.stmts)).toBe(true);
    expect((parseTree.stmts ?? []).length).toBeGreaterThan(0);
  });

  it('CreateEnumStmt × 2: privacy_request_kind_t and privacy_request_status_t', () => {
    const enums = collectNodes<Record<string, unknown>>(parseTree, 'CreateEnumStmt');
    const enumNames = enums
      .map((e) => {
        const typeName = (e.typeName as unknown[]) ?? [];
        // typeName is an array of String nodes — last one is the type name.
        const last = typeName[typeName.length - 1] as Record<string, unknown> | undefined;
        if (!last) return null;
        const stringNode = (last.String ?? last) as Record<string, unknown>;
        return (stringNode.sval ?? stringNode.str) as string | undefined;
      })
      .filter((n): n is string => typeof n === 'string');
    expect(enumNames).toContain('privacy_request_kind_t');
    expect(enumNames).toContain('privacy_request_status_t');
  });

  it('CreateStmt for privacy_requests has all 10 columns in spec order', () => {
    const table = findCreateTable('privacy_requests');
    expect(table).toBeDefined();
    const columns = listColumns(table!);
    const names = columns.map((c) => c.colname).filter((n): n is string => typeof n === 'string');
    expect(names).toEqual([
      'id',
      'profile_id',
      'requester_email',
      'kind',
      'status',
      'submitted_at',
      'resolved_at',
      'resolved_by',
      'reject_reason',
      'export_url',
    ]);
  });

  it('profile_id has FK to profiles with NO ACTION on delete', () => {
    const table = findCreateTable('privacy_requests');
    const columns = listColumns(table!);
    const profileIdCol = columns.find((c) => c.colname === 'profile_id');
    expect(profileIdCol).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(profileIdCol, 'Constraint');

    const fkConstraint = constraints.find((c) => c.contype === 'CONSTR_FOREIGN' || c.contype === 8);
    expect(fkConstraint).toBeDefined();
    const pktable = fkConstraint!.pktable as Record<string, unknown> | undefined;
    expect(pktable?.relname).toBe('profiles');

    // fk_del_action: must NOT be cascade ('c') or set-null ('n'). Accept
    // 'a' (NO ACTION) or empty/undefined (default = NO ACTION).
    const delAction = fkConstraint!.fk_del_action;
    expect(delAction).not.toBe('c');
    expect(delAction).not.toBe('n');
    expect(delAction).not.toBe('CASCADE');
    expect(delAction).not.toBe('SET NULL');
    const acceptableDefaults: (string | undefined)[] = ['a', 'NO ACTION', '', undefined];
    expect(acceptableDefaults).toContain(delAction as string | undefined);

    // profile_id is NOT NULL.
    const hasNotNull = constraints.some((c) => c.contype === 'CONSTR_NOTNULL' || c.contype === 1);
    expect(hasNotNull).toBe(true);
  });

  it('resolved_by has FK to auth.users with NO ACTION and is nullable', () => {
    const table = findCreateTable('privacy_requests');
    const columns = listColumns(table!);
    const resolvedByCol = columns.find((c) => c.colname === 'resolved_by');
    expect(resolvedByCol).toBeDefined();
    const constraints = collectNodes<Record<string, unknown>>(resolvedByCol, 'Constraint');

    const fkConstraint = constraints.find((c) => c.contype === 'CONSTR_FOREIGN' || c.contype === 8);
    expect(fkConstraint).toBeDefined();
    const pktable = fkConstraint!.pktable as Record<string, unknown> | undefined;
    expect(pktable?.relname).toBe('users');
    expect(pktable?.schemaname).toBe('auth');

    const delAction = fkConstraint!.fk_del_action;
    expect(delAction).not.toBe('c');
    expect(delAction).not.toBe('n');
    const acceptableDefaults: (string | undefined)[] = ['a', 'NO ACTION', '', undefined];
    expect(acceptableDefaults).toContain(delAction as string | undefined);

    // resolved_by is nullable (no CONSTR_NOTNULL).
    const hasNotNull = constraints.some((c) => c.contype === 'CONSTR_NOTNULL' || c.contype === 1);
    expect(hasNotNull).toBe(false);
  });

  it('CreatePolicyStmt × 3 for privacy_requests: select + insert + update; NO delete', () => {
    const policies = collectNodes<Record<string, unknown>>(parseTree, 'CreatePolicyStmt');
    const tablePolicies = policies.filter((p) => {
      const table = p.table as Record<string, unknown> | undefined;
      return table?.relname === 'privacy_requests';
    });
    expect(tablePolicies).toHaveLength(3);

    const byName = new Map<string, Record<string, unknown>>();
    for (const p of tablePolicies) {
      if (typeof p.policy_name === 'string') byName.set(p.policy_name, p);
    }

    const selectPolicy = byName.get('privacy_requests_select_self_or_manager');
    const insertPolicy = byName.get('privacy_requests_insert_self');
    const updatePolicy = byName.get('privacy_requests_update_manager');
    expect(selectPolicy).toBeDefined();
    expect(insertPolicy).toBeDefined();
    expect(updatePolicy).toBeDefined();

    // cmd_name pinning — accept lowercase or uppercase.
    expect(['select', 'SELECT']).toContain(selectPolicy!.cmd_name);
    expect(['insert', 'INSERT']).toContain(insertPolicy!.cmd_name);
    expect(['update', 'UPDATE']).toContain(updatePolicy!.cmd_name);

    // NO delete policies.
    const deletePolicies = tablePolicies.filter(
      (p) => p.cmd_name === 'delete' || p.cmd_name === 'DELETE',
    );
    expect(deletePolicies).toHaveLength(0);
  });

  it('select policy USING references profile_id, auth.uid(), and role_at_least(manager)', () => {
    const policy = findPolicy('privacy_requests_select_self_or_manager');
    expect(policy).toBeDefined();
    const qual = policy!.qual;
    expect(qual).toBeDefined();
    expect(qual).not.toBeNull();
    expect(subtreeContains(qual, 'profile_id')).toBe(true);
    expect(subtreeContains(qual, 'uid')).toBe(true);
    expect(subtreeContains(qual, 'role_at_least')).toBe(true);
    expect(subtreeContains(qual, 'manager')).toBe(true);
  });

  it('insert policy WITH CHECK references profile_id and auth.uid()', () => {
    const policy = findPolicy('privacy_requests_insert_self');
    expect(policy).toBeDefined();
    const withCheck = policy!.with_check;
    expect(withCheck).toBeDefined();
    expect(withCheck).not.toBeNull();
    expect(subtreeContains(withCheck, 'profile_id')).toBe(true);
    expect(subtreeContains(withCheck, 'uid')).toBe(true);
  });

  it('update policy USING and WITH CHECK both reference role_at_least(manager)', () => {
    const policy = findPolicy('privacy_requests_update_manager');
    expect(policy).toBeDefined();
    const qual = policy!.qual;
    const withCheck = policy!.with_check;
    expect(qual).toBeDefined();
    expect(withCheck).toBeDefined();
    expect(qual).not.toBeNull();
    expect(withCheck).not.toBeNull();
    expect(subtreeContains(qual, 'role_at_least')).toBe(true);
    expect(subtreeContains(qual, 'manager')).toBe(true);
    expect(subtreeContains(withCheck, 'role_at_least')).toBe(true);
    expect(subtreeContains(withCheck, 'manager')).toBe(true);
  });

  it('IndexStmt creates privacy_requests_status_idx on (status, submitted_at)', () => {
    const indices = collectNodes<Record<string, unknown>>(parseTree, 'IndexStmt');
    const statusIdx = indices.find((idx) => idx.idxname === 'privacy_requests_status_idx');
    expect(statusIdx).toBeDefined();
    const rel = statusIdx!.relation as Record<string, unknown> | undefined;
    expect(rel?.relname).toBe('privacy_requests');

    const params = (statusIdx!.indexParams as unknown[]) ?? [];
    const elemNames = params
      .map((p) => {
        const elem = (p as Record<string, unknown>).IndexElem as
          | Record<string, unknown>
          | undefined;
        return elem?.name;
      })
      .filter((n): n is string => typeof n === 'string');
    expect(elemNames).toEqual(['status', 'submitted_at']);
  });

  it('CreateSeqStmt creates member_number_seq (premortem R6 mitigation)', () => {
    const seqs = collectNodes<Record<string, unknown>>(parseTree, 'CreateSeqStmt');
    const memberSeq = seqs.find((s) => {
      const sequence = s.sequence as Record<string, unknown> | undefined;
      return sequence?.relname === 'member_number_seq';
    });
    expect(memberSeq).toBeDefined();
    // Subtree must mention 1000 (START WITH 1000).
    expect(subtreeContains(memberSeq, '1000')).toBe(true);
  });

  it('AlterTable ENABLE + FORCE row-level security on privacy_requests', () => {
    const alters = collectNodes<Record<string, unknown>>(parseTree, 'AlterTableStmt');
    const tableAlters = alters.filter((a) => {
      const rel = a.relation as Record<string, unknown> | undefined;
      return rel?.relname === 'privacy_requests';
    });
    // At least two AlterTableStmts touching privacy_requests (ENABLE + FORCE).
    expect(tableAlters.length).toBeGreaterThanOrEqual(2);
    // ENABLE RLS and FORCE RLS surface as AT_EnableRowSecurity and
    // AT_ForceRowSecurity AlterTableCmd subtypes — subtree-stringify and
    // substring-match is the most portable check across libpg_query versions.
    const dump = JSON.stringify(tableAlters);
    expect(dump).toMatch(/AT_EnableRowSecurity|EnableRowSecurity|ENABLE.*ROW/i);
    expect(dump).toMatch(/AT_ForceRowSecurity|ForceRowSecurity|FORCE.*ROW/i);
  });

  it('CommentStmt × ≥2: COMMENT ON TABLE and COMMENT ON COLUMN requester_email (R7)', () => {
    const comments = collectNodes<Record<string, unknown>>(parseTree, 'CommentStmt');
    // Find the table comment.
    const tableComment = comments.find((c) => {
      // CommentStmt has `objtype` and `object`. For COMMENT ON TABLE the
      // object is a List of String containing the table name.
      const dump = JSON.stringify(c);
      return /OBJECT_TABLE/.test(dump) && dump.includes('privacy_requests');
    });
    expect(tableComment).toBeDefined();
    expect(subtreeContains(tableComment, 'ADR-0035')).toBe(true);

    // Find the column comment on requester_email.
    const columnComment = comments.find((c) => {
      const dump = JSON.stringify(c);
      return (
        /OBJECT_COLUMN/.test(dump) &&
        dump.includes('privacy_requests') &&
        dump.includes('requester_email')
      );
    });
    expect(columnComment).toBeDefined();
    // R7 mitigation: comment body must contain "pre-anonymization" and the
    // export prohibition.
    expect(subtreeContains(columnComment, 'pre-anonymization')).toBe(true);
    expect(subtreeContains(columnComment, 'MUST NOT be exported')).toBe(true);
  });
});
