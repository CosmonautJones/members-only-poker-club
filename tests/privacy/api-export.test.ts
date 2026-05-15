/**
 * Tests for POST /api/privacy/export — ADR-0023 AC5.
 *
 * Sub-cases:
 *   1. No session → 401 { error: 'unauthorized' }.
 *   2. 200 returns profile.id === user.id.
 *   3. 200 returns auditLog filtered to actor_id === user.id only.
 *   4. Response carries Content-Disposition: attachment; filename="mopc-privacy-export-...".
 *   5. Response carries Cache-Control: private, no-store.
 *   6. Response JSON has exactly the keys generatedAt, schemaVersion, profile,
 *      auditLog, stripe, sentry, posthog (no surprise keys).
 *   7. stripe / sentry / posthog are null.
 *   8. 500 on simulated DB throw with no leak of the underlying error message.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER_ID = 'bbbbbbbb-1111-0000-0000-000000000002';

const mockProfile = {
  id: USER_ID,
  full_name: 'Test User',
  dob: '1990-01-01',
  phone: null,
  email: 'test@example.com',
  role: 'member',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
};

const mockAuditRows = [
  {
    id: 1,
    action: 'profile.view',
    target_type: 'profile',
    target_id: USER_ID,
    before: null,
    after: null,
    ip: '127.0.0.1',
    user_agent: 'TestBrowser',
    created_at: '2026-01-01T00:00:00.000Z',
  },
];

// Hoisted mock factories.
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  // Session client query builder.
  sessionFrom: vi.fn(),
  sessionSelect: vi.fn(),
  sessionEq: vi.fn(),
  sessionSingle: vi.fn(),
  // Admin client query builder.
  adminFrom: vi.fn(),
  adminSelect: vi.fn(),
  adminEq: vi.fn(),
  adminOrder: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.sessionFrom,
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: mocks.adminFrom,
  }),
}));

vi.mock('server-only', () => ({}));

import { POST } from '@/app/api/privacy/export/route';

function makeRequest(): Request {
  return new Request('http://localhost:3000/api/privacy/export', {
    method: 'POST',
  });
}

beforeEach(() => {
  vi.resetAllMocks();

  // Default session chain: .from().select().eq().single() → mockProfile
  const sessionChain = {
    select: mocks.sessionSelect,
    eq: mocks.sessionEq,
    single: mocks.sessionSingle,
  };
  mocks.sessionFrom.mockReturnValue(sessionChain);
  mocks.sessionSelect.mockReturnValue(sessionChain);
  mocks.sessionEq.mockReturnValue(sessionChain);
  mocks.sessionSingle.mockResolvedValue({ data: mockProfile, error: null });

  // Default admin chain: .from().select().eq().order() → mockAuditRows
  const adminChain = {
    select: mocks.adminSelect,
    eq: mocks.adminEq,
    order: mocks.adminOrder,
  };
  mocks.adminFrom.mockReturnValue(adminChain);
  mocks.adminSelect.mockReturnValue(adminChain);
  mocks.adminEq.mockReturnValue(adminChain);
  mocks.adminOrder.mockResolvedValue({ data: mockAuditRows, error: null });
});

describe('POST /api/privacy/export', () => {
  it('401 when no session', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'No session' } });

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe('unauthorized');
  });

  it('401 when getUser returns null user with no error', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
  });

  it('200 returns profile.id === user.id', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    const profile = body.profile as Record<string, unknown>;
    expect(profile.id).toBe(USER_ID);
  });

  it('200 returns auditLog filtered to actor_id = user.id (admin eq predicate)', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    // The admin client's eq() must have been called with ('actor_id', userId).
    expect(mocks.adminEq).toHaveBeenCalledWith('actor_id', USER_ID);
    const body = await response.json() as Record<string, unknown>;
    expect(Array.isArray(body.auditLog)).toBe(true);
  });

  it('Content-Disposition header is attachment with the user-id filename', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    const cd = response.headers.get('content-disposition') ?? '';
    expect(cd).toMatch(/attachment/i);
    expect(cd).toContain(`mopc-privacy-export-${USER_ID}.json`);
  });

  it('Cache-Control: private, no-store header', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    const cc = response.headers.get('cache-control') ?? '';
    expect(cc).toMatch(/private/i);
    expect(cc).toMatch(/no-store/i);
  });

  it('response JSON has exactly the expected top-level keys', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(['auditLog', 'generatedAt', 'posthog', 'profile', 'schemaVersion', 'sentry', 'stripe']);
  });

  it('stripe, sentry, posthog are null (Slice 1 placeholders)', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.stripe).toBeNull();
    expect(body.sentry).toBeNull();
    expect(body.posthog).toBeNull();
  });

  it('schemaVersion is 1', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

    const response = await POST(makeRequest());

    const body = await response.json() as Record<string, unknown>;
    expect(body.schemaVersion).toBe(1);
  });

  it('500 on simulated DB throw; error body does NOT leak the error message', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    // Simulate DB failure in the session-scoped profile query.
    mocks.sessionSingle.mockRejectedValue(new Error('connection reset: user@db.internal'));

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error).toBe('internal');
    // Must NOT leak error internals.
    expect(JSON.stringify(body)).not.toMatch(/connection reset/);
    expect(JSON.stringify(body)).not.toMatch(/user@db/);
  });
});
