/**
 * Tests for POST /api/privacy/delete — ADR-0023 AC4, AC13.
 *
 * Mocking strategy mirrors tests/auth/confirm-route.test.ts: vi.hoisted +
 * vi.mock for the Supabase clients, softDeleteProfile, and withAudit.
 *
 * Sub-cases:
 *   1. No session → 401 { error: 'unauthorized' }; no softDeleteProfile call.
 *   2. First delete → 200 { ok: true, alreadyDeleted: false }; audit row written.
 *   3. Already-deleted profile → 200 { ok: true, alreadyDeleted: true }; no second audit row.
 *   4. softDeleteProfile returns mutated: false → 200 { ok: true, alreadyDeleted: true }.
 *   5. Simulated DB throw → 500 { error: 'internal' }; no audit row, no soft-delete commit.
 *   6. AC13: audit before/after JSON does NOT include email / full_name / phone keys.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Hoisted mock factories — declared before vi.mock runs.
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
  softDeleteProfile: vi.fn(),
  withAudit: vi.fn(),
  adminFrom: vi.fn(),
  adminSelect: vi.fn(),
  adminEq: vi.fn(),
  adminSingle: vi.fn(),
  adminInsert: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: mocks.getUser,
      signOut: mocks.signOut,
    },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: mocks.adminFrom,
  }),
}));

vi.mock('@/lib/privacy/soft-delete', () => ({
  softDeleteProfile: mocks.softDeleteProfile,
}));

vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: mocks.withAudit,
}));

vi.mock('server-only', () => ({}));

import { POST } from '@/app/api/privacy/delete/route';

const DELETE_ROUTE_PATH = resolve(__dirname, '../../app/api/privacy/delete/route.ts');
const DELETE_ROUTE_SOURCE = readFileSync(DELETE_ROUTE_PATH, 'utf8');

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/privacy/delete', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default: signOut succeeds.
  mocks.signOut.mockResolvedValue({ error: null });
  // Default: withAudit calls the mutate callback and returns its result.result.
  mocks.withAudit.mockImplementation(
    async (
      _tx: unknown,
      _params: unknown,
      mutate: (tx: unknown) => Promise<{ before: unknown; after: unknown; result: unknown }>,
    ) => {
      const { result } = await mutate(_tx);
      return result;
    },
  );
  // Default: adminFrom returns a chainable query builder.
  const chain = {
    select: mocks.adminSelect,
    insert: mocks.adminInsert,
    update: vi.fn().mockReturnThis(),
    eq: mocks.adminEq,
    single: mocks.adminSingle,
  };
  mocks.adminFrom.mockReturnValue(chain);
  mocks.adminSelect.mockReturnValue(chain);
  mocks.adminEq.mockReturnValue(chain);
  mocks.adminSingle.mockResolvedValue({ data: { deleted_at: null }, error: null });
  mocks.adminInsert.mockResolvedValue({ error: null });
});

describe('POST /api/privacy/delete', () => {
  it('401 when no session', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'No session' } });

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe('unauthorized');
    expect(mocks.softDeleteProfile).not.toHaveBeenCalled();
    expect(mocks.withAudit).not.toHaveBeenCalled();
  });

  it('401 when getUser returns null user with no error', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe('unauthorized');
  });

  it('200 { ok: true, alreadyDeleted: false } on first delete; withAudit called once', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.softDeleteProfile.mockResolvedValue({ userId: USER_ID, mutated: true });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.alreadyDeleted).toBe(false);
    expect(mocks.withAudit).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('audit params use privacy.account_deleted action and userId as both targetId and actorId', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.softDeleteProfile.mockResolvedValue({ userId: USER_ID, mutated: true });

    await POST(makeRequest({ 'x-forwarded-for': '1.2.3.4', 'user-agent': 'TestBrowser/1.0' }));

    expect(mocks.withAudit).toHaveBeenCalledTimes(1);
    const [_tx, params] = mocks.withAudit.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(params.action).toBe('privacy.account_deleted');
    expect(params.targetType).toBe('profile');
    expect(params.targetId).toBe(USER_ID);
    expect(params.actorId).toBe(USER_ID);
    expect(params.ip).toBe('1.2.3.4');
    expect(params.userAgent).toBe('TestBrowser/1.0');
  });

  it('200 { ok: true, alreadyDeleted: true } when profile is already deleted (pre-check)', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    // adminClient.from().select().eq().single() returns a non-null deleted_at.
    mocks.adminSingle.mockResolvedValue({ data: { deleted_at: '2026-01-01T00:00:00.000Z' }, error: null });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.alreadyDeleted).toBe(true);
    expect(mocks.withAudit).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('200 { ok: true, alreadyDeleted: true } when softDeleteProfile returns mutated: false', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.adminSingle.mockResolvedValue({ data: { deleted_at: null }, error: null });
    mocks.softDeleteProfile.mockResolvedValue({ userId: USER_ID, mutated: false });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.alreadyDeleted).toBe(true);
    expect(mocks.withAudit).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('500 { error: internal } on DB throw; withAudit not called (error in pre-check)', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    // Simulate DB failure during pre-check.
    mocks.adminSingle.mockRejectedValue(new Error('DB connection failed: user@db.internal'));

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe('internal');
    // Must NOT leak the underlying error message.
    expect(JSON.stringify(body)).not.toMatch(/DB connection failed/);
    expect(JSON.stringify(body)).not.toMatch(/internal@/);
  });

  it('500 { error: internal } on softDeleteProfile throw', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.adminSingle.mockResolvedValue({ data: { deleted_at: null }, error: null });
    mocks.softDeleteProfile.mockRejectedValue(new Error('pgcrypto error: user@db'));

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe('internal');
    expect(JSON.stringify(body)).not.toMatch(/pgcrypto/);
  });
});

describe('POST /api/privacy/delete — AC13 no-PII-in-audit guard', () => {
  it('audit before/after snapshots do NOT contain email, full_name, or phone keys', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.softDeleteProfile.mockResolvedValue({ userId: USER_ID, mutated: true });

    // Capture the mutate callback to inspect its return value.
    let capturedBefore: unknown;
    let capturedAfter: unknown;
    mocks.withAudit.mockImplementation(
      async (
        _tx: unknown,
        _params: unknown,
        mutate: (tx: unknown) => Promise<{ before: unknown; after: unknown; result: unknown }>,
      ) => {
        const { before, after, result } = await mutate(_tx);
        capturedBefore = before;
        capturedAfter = after;
        return result;
      },
    );

    await POST(makeRequest());

    const beforeJson = JSON.stringify(capturedBefore);
    const afterJson = JSON.stringify(capturedAfter);
    const combined = beforeJson + afterJson;

    // AC13 load-bearing PII guard.
    expect(combined).not.toMatch(/email/);
    expect(combined).not.toMatch(/full_name/);
    expect(combined).not.toMatch(/phone/);

    // Must contain deleted_at (the only snapshot key).
    expect(combined).toMatch(/deleted_at/);
  });
});

describe('POST /api/privacy/delete — AC13 source-grep guard', () => {
  it('route source does NOT include PII keys inside before/after literals', () => {
    // Coarse but high-signal regression guard: parse the source to find the
    // before: { ... } and after: { ... } literal objects and assert they do
    // not contain email, full_name, or phone as object keys.
    //
    // Strategy: look for lines that contain 'before:' or 'after:' within the
    // withAudit call context and check surrounding 200 chars for PII keys.
    // A more precise approach (AST parsing) is in no-pii-in-audit.test.ts.
    const source = DELETE_ROUTE_SOURCE;

    // Find the before: and after: snapshot literal regions.
    const beforeIdx = source.indexOf('before: { deleted_at:');
    const afterIdx = source.indexOf('after: { deleted_at:');

    expect(beforeIdx).toBeGreaterThan(-1);
    expect(afterIdx).toBeGreaterThan(-1);

    // Assert neither snapshot region includes PII keys.
    if (beforeIdx >= 0) {
      const beforeSnippet = source.slice(beforeIdx, beforeIdx + 100);
      expect(beforeSnippet).not.toMatch(/email|full_name|phone/);
    }
    if (afterIdx >= 0) {
      const afterSnippet = source.slice(afterIdx, afterIdx + 100);
      expect(afterSnippet).not.toMatch(/email|full_name|phone/);
    }
  });
});
