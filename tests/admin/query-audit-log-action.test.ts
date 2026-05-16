/**
 * Unit tests for
 * `app/(admin)/admin/audit-log/_actions/queryAuditLog.ts` —
 * AC20 server action (ADR-0035 WB.T11 / t12).
 *
 * Run locally:    pnpm test tests/admin/query-audit-log-action.test.ts
 * Prerequisites:  none — pure module mocks, no DB.
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC20
 *
 * SUT contract (per AC20 + plan t12):
 *   - First await is `requireRole('manager')`.
 *   - Cookie-scoped supabase client; RLS gates SELECT.
 *   - NO audit event emitted (read-only path).
 *   - Default page size 50, max 200.
 *   - actorEmail filter: sub-query SELECT id FROM profiles WHERE email = $1,
 *     short-circuits to empty when email does not resolve.
 *   - Sort created_at DESC, parallel count(*).
 *
 * Mocking strategy: stub createClient with a fluent-builder spy whose
 * shape is configured per-test. The supabase client mock returns a
 * thenable chain that resolves to whatever the test pre-loaded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Hoisted mocks --------------------------------------------------------

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  // For each table call (.from('x')) we record the call args + return a
  // thenable. The thenable's resolved value is configured per-test.
  fromCalls: [] as Array<{ table: string; chain: ChainRecord }>,
  tableResponses: new Map<
    string,
    {
      // Match by predicate so multiple .from('audit_log') calls in the
      // same test (data + count) can return different shapes.
      match: (chain: ChainRecord) => boolean;
      value: {
        data?: unknown;
        count?: number | null;
        error?: { message: string } | null;
      };
    }[]
  >(),
}));

type ChainRecord = {
  table: string;
  select: string | null;
  selectOptions: Record<string, unknown> | null;
  isHead: boolean;
  filters: Array<{ method: string; args: unknown[] }>;
  orderArgs: unknown[] | null;
  rangeArgs: unknown[] | null;
};

vi.mock('server-only', () => ({}));

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

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from(table: string) {
      const chain: ChainRecord = {
        table,
        select: null,
        selectOptions: null,
        isHead: false,
        filters: [],
        orderArgs: null,
        rangeArgs: null,
      };
      mocks.fromCalls.push({ table, chain });

      function resolve(): {
        data?: unknown;
        count?: number | null;
        error?: { message: string } | null;
      } {
        const responses = mocks.tableResponses.get(table) ?? [];
        for (const r of responses) {
          if (r.match(chain)) return r.value;
        }
        // Default: empty success.
        return chain.isHead
          ? { count: 0, error: null }
          : { data: [], error: null };
      }

      const handler: ProxyHandler<Record<string, unknown>> = {
        get(_target, prop: string) {
          if (prop === 'then') {
            return (
              onFulfilled: (v: {
                data?: unknown;
                count?: number | null;
                error?: { message: string } | null;
              }) => unknown,
            ) => Promise.resolve(resolve()).then(onFulfilled);
          }
          if (prop === 'select') {
            return (cols: string, opts?: Record<string, unknown>) => {
              chain.select = cols;
              chain.selectOptions = opts ?? null;
              if (opts && opts['head'] === true) chain.isHead = true;
              return proxy;
            };
          }
          if (prop === 'order') {
            return (...args: unknown[]) => {
              chain.orderArgs = args;
              return proxy;
            };
          }
          if (prop === 'range') {
            return (...args: unknown[]) => {
              chain.rangeArgs = args;
              return proxy;
            };
          }
          if (prop === 'maybeSingle') {
            return () => Promise.resolve(resolve());
          }
          if (prop === 'single') {
            return () => Promise.resolve(resolve());
          }
          // Generic filter method (.eq, .like, .gte, .lte, .in, .is, .not, ...)
          return (...args: unknown[]) => {
            chain.filters.push({ method: prop, args });
            return proxy;
          };
        },
      };
      const proxy = new Proxy({}, handler) as Record<string, unknown>;
      return proxy;
    },
  }),
}));

// Import AFTER mocks.
// eslint-disable-next-line import/first
import {
  queryAuditLog,
} from '@/app/(admin)/admin/audit-log/_actions/queryAuditLog';

// ---- Test helpers ---------------------------------------------------------

const baseProfile = {
  id: 'uuid-test-manager',
  role: 'manager',
  full_name: 'Test Manager',
  email: 'manager@example.com',
};

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: baseProfile });
  mocks.fromCalls.length = 0;
  mocks.tableResponses.clear();
});

// Convenience: set the audit_log data + count + (optional) profile join lookup.
function setAuditRows(rows: unknown[], total = rows.length) {
  mocks.tableResponses.set('audit_log', [
    {
      // The data query selects multiple columns and does NOT set head:true.
      match: (chain) => !chain.isHead,
      value: { data: rows, error: null },
    },
    {
      // The count query has head: true.
      match: (chain) => chain.isHead,
      value: { count: total, error: null },
    },
  ]);
}

// ---- Tests ----------------------------------------------------------------

describe('queryAuditLog — gate', () => {
  it('first-await is requireRole("manager")', async () => {
    setAuditRows([]);
    await queryAuditLog({});
    expect(mocks.requireRole).toHaveBeenCalledTimes(1);
    expect(mocks.requireRole).toHaveBeenCalledWith('manager');
  });

  it('propagates a thrown InsufficientRoleError from requireRole', async () => {
    const err = new Error('InsufficientRoleError');
    err.name = 'InsufficientRoleError';
    mocks.requireRole.mockRejectedValueOnce(err);
    await expect(queryAuditLog({})).rejects.toThrow(/InsufficientRoleError/);
  });
});

describe('queryAuditLog — manager session returns rows', () => {
  it('returns audit rows + total when called with no filters', async () => {
    setAuditRows(
      [
        {
          id: 5,
          action: 'admin.member.role_changed',
          target_type: 'profile',
          target_id: 'uuid-a',
          before: { role: 'member' },
          after: { role: 'cashier' },
          ip: '192.168.1.10',
          user_agent: 'Mozilla',
          created_at: '2026-05-15T14:32:08Z',
          actor_id: 'uuid-actor-1',
          actor: { email: 'manager@example.com' },
        },
      ],
      1,
    );
    const result = await queryAuditLog({});
    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
    expect(result.rows[0]!.actor_email).toBe('manager@example.com');
  });

  it('extracts actor_email from a single-element array embedded resource', async () => {
    setAuditRows([
      {
        id: 1,
        action: 'admin.x',
        target_type: 'profile',
        target_id: 'uuid-x',
        before: null,
        after: null,
        ip: null,
        user_agent: null,
        created_at: '2026-05-15T00:00:00Z',
        actor_id: 'uuid-actor-1',
        actor: [{ email: 'array-form@example.com' }],
      },
    ]);
    const result = await queryAuditLog({});
    expect(result.rows[0]!.actor_email).toBe('array-form@example.com');
  });

  it('returns actor_email === null when the LEFT JOIN misses', async () => {
    setAuditRows([
      {
        id: 1,
        action: 'admin.x',
        target_type: 'feature_flag',
        target_id: 'kill-x',
        before: null,
        after: null,
        ip: null,
        user_agent: null,
        created_at: '2026-05-15T00:00:00Z',
        actor_id: null,
        actor: null,
      },
    ]);
    const result = await queryAuditLog({});
    expect(result.rows[0]!.actor_email).toBeNull();
  });
});

describe('queryAuditLog — cashier session returns empty (RLS gate works via mocked client)', () => {
  it('returns empty rows + total 0 when RLS hides every row', async () => {
    // Simulate cashier: requireRole still resolves (the role-gate would
    // have thrown in real code, but the test injects a downgraded
    // profile to model the post-gate RLS behavior). The supabase client
    // returns empty data + count 0 — that is the shape RLS produces
    // when the policy fails for every row.
    mocks.requireRole.mockResolvedValueOnce({
      profile: { ...baseProfile, role: 'cashier' },
    });
    setAuditRows([], 0);

    const result = await queryAuditLog({});
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('queryAuditLog — filter shapes', () => {
  it('applies WHERE action LIKE prefix% when actionPrefix is provided', async () => {
    setAuditRows([]);
    await queryAuditLog({ actionPrefix: 'admin.member.' });
    const auditCalls = mocks.fromCalls.filter((c) => c.table === 'audit_log');
    expect(auditCalls.length).toBeGreaterThanOrEqual(2); // data + count
    const dataChain = auditCalls.find((c) => !c.chain.isHead)!.chain;
    const likeFilter = dataChain.filters.find((f) => f.method === 'like');
    expect(likeFilter).toBeTruthy();
    expect(likeFilter!.args[0]).toBe('action');
    expect(likeFilter!.args[1]).toBe('admin.member.%');
  });

  it('applies eq on target_type / target_id when those filters are set', async () => {
    setAuditRows([]);
    await queryAuditLog({ targetType: 'profile', targetId: 'uuid-a' });
    const dataChain = mocks.fromCalls.find((c) => c.table === 'audit_log' && !c.chain.isHead)!
      .chain;
    const eqFilters = dataChain.filters.filter((f) => f.method === 'eq');
    const targetTypeFilter = eqFilters.find((f) => f.args[0] === 'target_type');
    const targetIdFilter = eqFilters.find((f) => f.args[0] === 'target_id');
    expect(targetTypeFilter?.args[1]).toBe('profile');
    expect(targetIdFilter?.args[1]).toBe('uuid-a');
  });

  it('applies gte / lte on created_at when fromUtc + toUtc are set', async () => {
    setAuditRows([]);
    await queryAuditLog({
      fromUtc: '2026-05-15T08:00:00.000Z',
      toUtc: '2026-05-15T20:00:00.000Z',
    });
    const dataChain = mocks.fromCalls.find((c) => c.table === 'audit_log' && !c.chain.isHead)!
      .chain;
    const gte = dataChain.filters.find((f) => f.method === 'gte');
    const lte = dataChain.filters.find((f) => f.method === 'lte');
    expect(gte?.args).toEqual(['created_at', '2026-05-15T08:00:00.000Z']);
    expect(lte?.args).toEqual(['created_at', '2026-05-15T20:00:00.000Z']);
  });

  it('sorts by created_at DESC', async () => {
    setAuditRows([]);
    await queryAuditLog({});
    const dataChain = mocks.fromCalls.find((c) => c.table === 'audit_log' && !c.chain.isHead)!
      .chain;
    expect(dataChain.orderArgs?.[0]).toBe('created_at');
    expect((dataChain.orderArgs?.[1] as { ascending: boolean }).ascending).toBe(false);
  });

  it('runs a parallel count(*) on the same filters', async () => {
    setAuditRows([], 42);
    const result = await queryAuditLog({ actionPrefix: 'admin.' });
    const countChain = mocks.fromCalls.find((c) => c.table === 'audit_log' && c.chain.isHead)!
      .chain;
    expect(countChain.isHead).toBe(true);
    expect(countChain.selectOptions?.['count']).toBe('exact');
    expect(result.total).toBe(42);
    // Count query carries the same prefix filter:
    const like = countChain.filters.find((f) => f.method === 'like');
    expect(like?.args[1]).toBe('admin.%');
  });
});

describe('queryAuditLog — actorEmail sub-query', () => {
  it('resolves actor email → UUID via a profiles SELECT and applies eq actor_id', async () => {
    // First call (profiles lookup) → returns { id }.
    mocks.tableResponses.set('profiles', [
      {
        match: () => true,
        value: { data: { id: 'uuid-actor-99' }, error: null },
      },
    ]);
    setAuditRows([]);

    await queryAuditLog({ actorEmail: 'someone@example.com' });

    const profilesCall = mocks.fromCalls.find((c) => c.table === 'profiles');
    expect(profilesCall).toBeTruthy();
    const profileEq = profilesCall!.chain.filters.find((f) => f.method === 'eq');
    expect(profileEq?.args).toEqual(['email', 'someone@example.com']);

    const auditDataChain = mocks.fromCalls.find((c) => c.table === 'audit_log' && !c.chain.isHead)!
      .chain;
    const actorEqFilter = auditDataChain.filters.find(
      (f) => f.method === 'eq' && f.args[0] === 'actor_id',
    );
    expect(actorEqFilter?.args[1]).toBe('uuid-actor-99');
  });

  it('short-circuits to empty rows when actorEmail does not resolve', async () => {
    mocks.tableResponses.set('profiles', [
      {
        match: () => true,
        value: { data: null, error: null },
      },
    ]);
    // NB: setAuditRows intentionally NOT called — the action must
    // never reach audit_log.

    const result = await queryAuditLog({ actorEmail: 'ghost@example.com' });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    // No audit_log query should have been issued.
    const auditCalls = mocks.fromCalls.filter((c) => c.table === 'audit_log');
    expect(auditCalls.length).toBe(0);
  });
});

describe('queryAuditLog — pagination', () => {
  it('applies range(0, 49) for page 1 default pageSize', async () => {
    setAuditRows([]);
    await queryAuditLog({});
    const dataChain = mocks.fromCalls.find((c) => c.table === 'audit_log' && !c.chain.isHead)!
      .chain;
    expect(dataChain.rangeArgs).toEqual([0, 49]);
  });

  it('applies range(50, 99) for page 2 default pageSize', async () => {
    setAuditRows([]);
    await queryAuditLog({ page: 2 });
    const dataChain = mocks.fromCalls.find((c) => c.table === 'audit_log' && !c.chain.isHead)!
      .chain;
    expect(dataChain.rangeArgs).toEqual([50, 99]);
  });

  it('caps pageSize at 200', async () => {
    setAuditRows([]);
    const result = await queryAuditLog({ pageSize: 9999 });
    const dataChain = mocks.fromCalls.find((c) => c.table === 'audit_log' && !c.chain.isHead)!
      .chain;
    expect(dataChain.rangeArgs).toEqual([0, 199]);
    expect(result.pageSize).toBe(200);
  });

  it('defaults pageSize to 50 for invalid input', async () => {
    setAuditRows([]);
    const result = await queryAuditLog({ pageSize: -5 });
    expect(result.pageSize).toBe(50);
  });

  it('clamps page < 1 to page 1', async () => {
    setAuditRows([]);
    const result = await queryAuditLog({ page: 0 });
    expect(result.page).toBe(1);
  });
});

describe('queryAuditLog — source invariants (AC20 contract)', () => {
  it('imports "server-only" so it cannot be bundled into a client component', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const file = path.resolve(
      __dirname,
      '..',
      '..',
      'app',
      '(admin)',
      'admin',
      'audit-log',
      '_actions',
      'queryAuditLog.ts',
    );
    const src = readFileSync(file, 'utf8');
    expect(src).toMatch(/^import\s+['"]server-only['"];/m);
  });

  it('does NOT emit an audit event (read-only path — ADR-0006)', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const file = path.resolve(
      __dirname,
      '..',
      '..',
      'app',
      '(admin)',
      'admin',
      'audit-log',
      '_actions',
      'queryAuditLog.ts',
    );
    const src = readFileSync(file, 'utf8');
    expect(src).not.toMatch(/withAudit\(/);
    expect(src).not.toMatch(/from\(['"]audit_log['"]\)\s*\.insert/);
  });

  it('uses cookie-scoped createClient from lib/supabase/server (R1 mitigation)', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const file = path.resolve(
      __dirname,
      '..',
      '..',
      'app',
      '(admin)',
      'admin',
      'audit-log',
      '_actions',
      'queryAuditLog.ts',
    );
    const src = readFileSync(file, 'utf8');
    expect(src).toMatch(/from\s+['"]@\/lib\/supabase\/server['"]/);
    expect(src).not.toMatch(/from\s+['"]@\/lib\/supabase\/admin['"]/);
  });
});
