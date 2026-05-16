/**
 * Unit tests for the `searchMembers` server action — ADR-0035 AC9, WA.T5.
 *
 * Run locally:    pnpm test tests/admin/search-members-action.test.ts
 * Prerequisites:  none — pure module mocks (no DB, no network).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC9
 *       (server action shape, requireRole gate, q trim/lower/truncate,
 *       cookie-scoped client, parallel count, no audit event, malformed
 *       page/pageSize clamping, premortem R11 min-2-char floor).
 *
 * SUT contract:
 *   - First runtime statement: `await requireRole('manager');`
 *   - `q` normalization: trim → lowercase → truncate-to-64.
 *   - Premortem R11: `q.length < 2` after trim → q filter IGNORED.
 *   - `q` provided (>= 2 chars): ILIKE on `full_name` AND `email`
 *     (OR'd via `.or(...)`).
 *   - Cookie-scoped `createClient()` — NOT the admin/service-role
 *     client (verified by source-grep below).
 *   - Parallel `count(*)` for total + row fetch.
 *   - NO audit event — read-only (verified by source-grep).
 *   - Page/pageSize clamping: negative, non-integer, NaN, Infinity →
 *     defaults (page=1, pageSize=25); above-max pageSize → 100.
 *
 * Mocking strategy mirrors `tests/admin/dashboard-page.test.tsx`:
 *   - vi.mock('server-only')
 *   - vi.mock('next/headers') — `requireRole` reads x-pathname etc.
 *   - vi.mock('next/navigation', { redirect })
 *   - vi.mock('@/lib/auth/requireRole') — controlled directly so we
 *     can assert it was called with 'manager'.
 *   - vi.mock('@/lib/supabase/server', { createClient }) —
 *     fluent-builder spy that records every method call so we can
 *     assert the SQL filter shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ---- Hoisted mock primitives ----------------------------------------------

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn<(required: string) => Promise<{ profile: { id: string; role: string } }>>(),
  /**
   * Records every fluent-builder method call so the test can assert
   * filter shape (e.g. ".or('full_name.ilike.%foo%,email.ilike.%foo%')").
   * Each entry is { table, method, args } in call order.
   */
  builderCalls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  /**
   * The mock count/data the builder resolves to. The same value
   * is returned for both the count query and the rows query (since
   * the test only asserts shape, not numeric correctness — separate
   * suite-level beforeEach reassigns when needed).
   */
  countResult: { count: 0, error: null as { message: string } | null },
  rowsResult: { data: [] as unknown[], error: null as { message: string } | null },
}));

// ---- Mocks ----------------------------------------------------------------

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  headers: () => new Map<string, string>(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((p: string) => {
    const e = new Error(`NEXT_REDIRECT: ${p}`);
    (e as Error & { digest?: string }).digest = `NEXT_REDIRECT;${p}`;
    throw e;
  }),
}));

vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: mocks.requireRole,
}));

// Fluent-builder spy. Each chain method records its name and args
// onto `mocks.builderCalls` and returns the same chain. The chain
// is awaitable via a `then` resolver — count chains resolve to
// `mocks.countResult`, row chains to `mocks.rowsResult`.
//
// We distinguish count chains from row chains by the presence of
// `{ count: 'exact', head: true }` in the FIRST `.select(...)` call
// for that chain.
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from(table: string) {
      return makeChain(table, false);
    },
  }),
}));

function makeChain(table: string, isCount: boolean) {
  const localIsCount = { value: isCount };
  const chain: Record<string, unknown> = {};
  const methods = [
    'select',
    'eq',
    'or',
    'order',
    'range',
    'limit',
    'is',
    'not',
    'in',
    'gt',
    'gte',
    'lt',
    'lte',
    'ilike',
    'like',
    'filter',
  ];
  for (const m of methods) {
    chain[m] = (...args: unknown[]) => {
      mocks.builderCalls.push({ table, method: m, args });
      // Detect head-only count query on the first select call.
      if (m === 'select') {
        const opts = args[1] as { count?: string; head?: boolean } | undefined;
        if (opts && opts.head === true && opts.count === 'exact') {
          localIsCount.value = true;
        }
      }
      return chain;
    };
  }
  chain['then'] = (
    onFulfilled: (v: {
      count?: number | null;
      data?: unknown;
      error?: { message: string } | null;
    }) => unknown,
  ) => {
    const value = localIsCount.value ? mocks.countResult : mocks.rowsResult;
    return Promise.resolve(value).then(onFulfilled);
  };
  return chain;
}

// ---- Import AFTER vi.mock so the SUT picks up the stubs -------------------

// eslint-disable-next-line import/first
import { searchMembers } from '@/app/(admin)/admin/members/_actions/searchMembers';

const ACTION_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'app',
  '(admin)',
  'admin',
  'members',
  '_actions',
  'searchMembers.ts',
);

// ---- Helpers --------------------------------------------------------------

const baseProfile = {
  id: 'uuid-test-manager',
  role: 'manager' as const,
  full_name: 'Test Manager',
  email: 'manager@example.com',
};

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: baseProfile });
  mocks.builderCalls.length = 0;
  mocks.countResult = { count: 0, error: null };
  mocks.rowsResult = { data: [], error: null };
});

/**
 * Filter calls down to only the `.or(...)` and `.eq(...)` calls — the
 * ones that carry the SQL filter shape. Useful for "did the action
 * push a q filter at all?" assertions.
 */
function filterCalls(): Array<{ method: string; args: unknown[] }> {
  return mocks.builderCalls
    .filter((c) => c.method === 'or' || c.method === 'eq')
    .map((c) => ({ method: c.method, args: c.args }));
}

/**
 * Read the `.or(...)` calls — these are the q-filter calls.
 */
function orCalls(): unknown[][] {
  return mocks.builderCalls.filter((c) => c.method === 'or').map((c) => c.args);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('searchMembers — requireRole gate', () => {
  it('calls requireRole("manager") on every invocation', async () => {
    await searchMembers({});
    expect(mocks.requireRole).toHaveBeenCalledTimes(1);
    expect(mocks.requireRole).toHaveBeenCalledWith('manager');
  });

  it('propagates a thrown InsufficientRoleError from requireRole (does not swallow)', async () => {
    const err = new Error('InsufficientRoleError');
    err.name = 'InsufficientRoleError';
    mocks.requireRole.mockRejectedValueOnce(err);
    await expect(searchMembers({})).rejects.toThrow(/InsufficientRoleError/);
  });
});

describe('searchMembers — q filter shape (AC9)', () => {
  it('emits ILIKE on full_name AND email when q has >= 2 chars', async () => {
    await searchMembers({ q: 'alice' });
    const ors = orCalls();
    // Both the count chain AND the rows chain push an `.or(...)` —
    // so we expect TWO calls with the same filter string.
    expect(ors.length).toBe(2);
    // Each `.or(...)` arg is the filter string; assert it covers
    // BOTH full_name and email with ILIKE, joined by a comma (the
    // Supabase OR-syntax).
    for (const args of ors) {
      const filter = args[0] as string;
      expect(filter).toMatch(/full_name\.ilike\./i);
      expect(filter).toMatch(/email\.ilike\./i);
      // The user-supplied "alice" appears lowercased.
      expect(filter.toLowerCase()).toContain('alice');
    }
  });

  it('lowercases the q value before passing to ILIKE', async () => {
    await searchMembers({ q: 'ALICE' });
    const ors = orCalls();
    expect(ors.length).toBeGreaterThan(0);
    for (const args of ors) {
      const filter = args[0] as string;
      // The lowercased value appears; uppercase form does NOT.
      expect(filter).toContain('alice');
      expect(filter).not.toContain('ALICE');
    }
  });

  it('trims whitespace from q before applying the filter', async () => {
    await searchMembers({ q: '   alice   ' });
    const ors = orCalls();
    expect(ors.length).toBeGreaterThan(0);
    for (const args of ors) {
      const filter = args[0] as string;
      // The substring "alice" appears; the leading/trailing whitespace
      // does NOT (would have been wrapped between % signs).
      expect(filter).toContain('alice');
      expect(filter).not.toMatch(/\s{3,}alice/);
    }
  });

  it('truncates q to 64 chars when input exceeds the cap (positive test)', async () => {
    // 80-char input — 16 over the 64-char cap.
    const longQ = 'a'.repeat(80);
    await searchMembers({ q: longQ });
    const ors = orCalls();
    expect(ors.length).toBeGreaterThan(0);
    for (const args of ors) {
      const filter = args[0] as string;
      // The longest contiguous run of "a"s in the filter MUST be
      // exactly 64 (we wrap in %…% so the run is enclosed but
      // length-pinned).
      const longestRun = filter.match(/a+/g)?.reduce((max, run) => Math.max(max, run.length), 0);
      expect(longestRun).toBe(64);
    }
  });

  it('IGNORES q when q.length < 2 after trim (premortem R11 mitigation)', async () => {
    // Single-char q → identical behavior to no q at all.
    await searchMembers({ q: 'a' });
    expect(orCalls()).toEqual([]);
  });

  it('IGNORES q="a" and q="" produce identical query shape (R11 floor)', async () => {
    // First call: q='a' (below R11 floor).
    await searchMembers({ q: 'a' });
    const singleCharCalls = [...mocks.builderCalls];

    // Reset and call with q omitted.
    mocks.builderCalls.length = 0;
    await searchMembers({});
    const noCalls = [...mocks.builderCalls];

    // Both produce the same call sequence (no `.or(...)` either way).
    expect(singleCharCalls.filter((c) => c.method === 'or')).toEqual([]);
    expect(noCalls.filter((c) => c.method === 'or')).toEqual([]);
    // And the rest of the chain shape matches (same methods in same
    // order). Compare structurally.
    expect(singleCharCalls.map((c) => `${c.table}.${c.method}`)).toEqual(
      noCalls.map((c) => `${c.table}.${c.method}`),
    );
  });

  it('IGNORES q when it is only whitespace (trim → "")', async () => {
    await searchMembers({ q: '   ' });
    expect(orCalls()).toEqual([]);
  });

  it('escapes % and _ wildcards in q so they cannot become wildcards', async () => {
    await searchMembers({ q: '100%' });
    const ors = orCalls();
    expect(ors.length).toBeGreaterThan(0);
    for (const args of ors) {
      const filter = args[0] as string;
      // The literal '%' character is escaped via backslash before
      // it could become a wildcard. The wrapper `%…%` pair is
      // present, but the inner '%' is escaped.
      expect(filter).toMatch(/100\\%/);
    }
  });

  it('emits NO .or() call when q is undefined (only status/role filters apply)', async () => {
    await searchMembers({ role: 'manager' });
    expect(orCalls()).toEqual([]);
  });
});

describe('searchMembers — status + role filter shape', () => {
  it('applies role filter via .eq("role", value)', async () => {
    await searchMembers({ role: 'cashier' });
    const eqs = filterCalls().filter((c) => c.method === 'eq');
    const roleEqs = eqs.filter((c) => c.args[0] === 'role');
    expect(roleEqs.length).toBeGreaterThan(0);
    expect(roleEqs[0]?.args[1]).toBe('cashier');
  });

  it('applies status filter via .eq("memberships.status", value) on joined table', async () => {
    await searchMembers({ status: 'active' });
    const eqs = filterCalls().filter((c) => c.method === 'eq');
    const statusEqs = eqs.filter((c) => c.args[0] === 'memberships.status');
    expect(statusEqs.length).toBeGreaterThan(0);
    expect(statusEqs[0]?.args[1]).toBe('active');
  });

  it('applies BOTH status and role filters when both supplied', async () => {
    await searchMembers({ status: 'past_due', role: 'member' });
    const eqs = filterCalls().filter((c) => c.method === 'eq');
    expect(eqs.find((c) => c.args[0] === 'role' && c.args[1] === 'member')).toBeTruthy();
    expect(
      eqs.find((c) => c.args[0] === 'memberships.status' && c.args[1] === 'past_due'),
    ).toBeTruthy();
  });
});

describe('searchMembers — pagination clamping', () => {
  it('uses defaults when page/pageSize are omitted', async () => {
    const result = await searchMembers({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
  });

  it('clamps negative page to default (1)', async () => {
    const result = await searchMembers({ page: -5 });
    expect(result.page).toBe(1);
  });

  it('clamps zero page to default (1)', async () => {
    const result = await searchMembers({ page: 0 });
    expect(result.page).toBe(1);
  });

  it('clamps NaN page to default (1)', async () => {
    const result = await searchMembers({ page: Number.NaN });
    expect(result.page).toBe(1);
  });

  it('clamps Infinity page to default (1)', async () => {
    const result = await searchMembers({ page: Number.POSITIVE_INFINITY });
    expect(result.page).toBe(1);
  });

  it('clamps non-integer page to default (1)', async () => {
    const result = await searchMembers({ page: 1.5 });
    expect(result.page).toBe(1);
  });

  it('accepts a valid positive integer page', async () => {
    const result = await searchMembers({ page: 3 });
    expect(result.page).toBe(3);
  });

  it('clamps pageSize > 100 to 100 (max enforced)', async () => {
    const result = await searchMembers({ pageSize: 500 });
    expect(result.pageSize).toBe(100);
  });

  it('clamps zero pageSize to default (25)', async () => {
    const result = await searchMembers({ pageSize: 0 });
    expect(result.pageSize).toBe(25);
  });

  it('clamps negative pageSize to default (25)', async () => {
    const result = await searchMembers({ pageSize: -10 });
    expect(result.pageSize).toBe(25);
  });

  it('accepts pageSize = 50 (within range)', async () => {
    const result = await searchMembers({ pageSize: 50 });
    expect(result.pageSize).toBe(50);
  });

  it('issues a .range(from, to) call with the clamped page/pageSize', async () => {
    await searchMembers({ page: 3, pageSize: 25 });
    const rangeCalls = mocks.builderCalls.filter((c) => c.method === 'range');
    // page=3, pageSize=25 → from=50, to=74.
    const matching = rangeCalls.find(
      (c) => (c.args[0] as number) === 50 && (c.args[1] as number) === 74,
    );
    expect(matching).toBeTruthy();
  });
});

describe('searchMembers — parallel count + rows + no audit', () => {
  it('issues a head-only count query AND a rows query against profiles', async () => {
    await searchMembers({});
    // Find the FIRST .select(...) call for each chain. Count is the
    // one whose second arg has { count: 'exact', head: true }.
    const selectCalls = mocks.builderCalls.filter((c) => c.method === 'select');
    expect(selectCalls.length).toBeGreaterThanOrEqual(2);
    const countSelect = selectCalls.find((c) => {
      const opts = c.args[1] as { count?: string; head?: boolean } | undefined;
      return opts?.head === true && opts.count === 'exact';
    });
    expect(countSelect).toBeTruthy();
    expect(countSelect?.table).toBe('profiles');
  });

  it('returns total from the parallel count(*) query', async () => {
    mocks.countResult = { count: 137, error: null };
    mocks.rowsResult = { data: [], error: null };
    const result = await searchMembers({});
    expect(result.total).toBe(137);
  });

  it('returns rows from the data query', async () => {
    mocks.countResult = { count: 1, error: null };
    mocks.rowsResult = {
      data: [
        {
          id: 'uuid-1',
          full_name: 'Alice Example',
          email: 'alice@example.com',
          member_number: 42,
          role: 'member',
          id_verified_at: '2026-05-15T12:00:00.000Z',
          created_at: '2026-05-15T10:00:00.000Z',
          deleted_at: null,
          memberships: [{ status: 'active' }],
        },
      ],
      error: null,
    };
    const result = await searchMembers({});
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]?.full_name).toBe('Alice Example');
    expect(result.rows[0]?.status).toBe('active');
    expect(result.rows[0]?.deleted_at).toBeNull();
  });

  it('returns empty + total=0 when supabase reports an error (graceful)', async () => {
    mocks.countResult = { count: null as unknown as number, error: { message: 'boom' } };
    mocks.rowsResult = { data: null as unknown as unknown[], error: { message: 'boom' } };
    const result = await searchMembers({});
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('orders by created_at DESC (newest first)', async () => {
    await searchMembers({});
    const orderCalls = mocks.builderCalls.filter((c) => c.method === 'order');
    expect(orderCalls.length).toBeGreaterThan(0);
    const desc = orderCalls.find(
      (c) => c.args[0] === 'created_at' && (c.args[1] as { ascending?: boolean })?.ascending === false,
    );
    expect(desc).toBeTruthy();
  });

  it('queries the `profiles` table (NOT a service-role or other table)', async () => {
    await searchMembers({});
    const tables = new Set(mocks.builderCalls.map((c) => c.table));
    expect(tables.has('profiles')).toBe(true);
  });
});

describe('searchMembers — source invariants (AC9, R1, R11)', () => {
  it('contains `import \'server-only\'` at the top of the file', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    // The first non-trivial statement-level token must be the
    // server-only import. We strip leading comments + whitespace.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .trimStart();
    expect(stripped.startsWith("import 'server-only'") || stripped.startsWith('import "server-only"')).toBe(true);
  });

  it('first body await is `await requireRole(\'manager\')` (AC5 defense-in-depth)', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    // Find the exported `searchMembers` function body and assert its
    // first await is `requireRole('manager')`. Coarse but
    // independently-implemented (the AST walker lives in the
    // admin-routes-defense-in-depth suite).
    const fnMatch = src.match(
      /export\s+async\s+function\s+searchMembers\s*\([^)]*\)\s*:[^{]*\{/,
    );
    expect(fnMatch).toBeTruthy();
    const bodyStart = fnMatch!.index! + fnMatch![0].length;
    const stripped = src
      .slice(bodyStart)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    const awaitMatch = stripped.match(/\bawait\b/);
    expect(awaitMatch).toBeTruthy();
    const after = stripped.slice(
      (awaitMatch!.index ?? 0) + 'await'.length,
      (awaitMatch!.index ?? 0) + 'await'.length + 40,
    );
    expect(after).toMatch(/^\s*requireRole\s*\(\s*['"]manager['"]\s*\)/);
  });

  it('uses cookie-scoped `createClient()` from `@/lib/supabase/server` (R1 mitigation)', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/from\s*['"]@\/lib\/supabase\/server['"]/);
    // Must NOT import from the admin / service-role client.
    expect(src).not.toMatch(/from\s*['"]@\/lib\/supabase\/admin['"]/);
  });

  it('contains NO audit-event emission (read-only per ADR-0006)', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    // No withAudit import, no audit_log writes, no insert('audit_log').
    expect(src).not.toMatch(/withAudit/);
    expect(src).not.toMatch(/insertAuditLog/);
    expect(src).not.toMatch(/from\(['"]audit_log['"]\)/);
    expect(src).not.toMatch(/\.insert\([^)]*audit/i);
  });

  it('pins the R11 min-length floor at >= 2 chars in source', () => {
    // The premortem R11 mitigation requires q.length < 2 → ignored.
    // Source-grep the literal `Q_MIN_LENGTH = 2` or an equivalent
    // `.length < 2` guard so a future refactor cannot silently lower
    // the floor.
    const src = readFileSync(ACTION_PATH, 'utf8');
    const hasMinConst = /Q_MIN_LENGTH\s*=\s*2\b/.test(src);
    const hasMinComparison = /\.length\s*<\s*2\b/.test(src);
    expect(hasMinConst || hasMinComparison).toBe(true);
  });

  it('pins the 64-char truncation in source', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    const hasMaxConst = /Q_MAX_LENGTH\s*=\s*64\b/.test(src);
    const hasSliceCall = /\.slice\(\s*0\s*,\s*64\b/.test(src);
    expect(hasMaxConst || hasSliceCall).toBe(true);
  });
});
