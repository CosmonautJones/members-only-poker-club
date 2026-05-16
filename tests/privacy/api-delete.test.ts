/**
 * Tests for POST /api/privacy/delete — ADR-0023 AC4, AC13.
 *
 * Mocks only the supabase server + admin clients. The route's anonymization
 * and audit-row writes go through real .from()/.update()/.insert() chains
 * (mocked at the supabase boundary); softDeleteProfile is NOT involved in
 * the production path so it is not mocked here.
 *
 * Sub-cases:
 *   1. 401 when no session; no DB writes.
 *   2. First delete → 200 { alreadyDeleted: false }; profiles.update() called
 *      with del:<sha256-hex> anonymization tokens; audit_log.insert() called
 *      with no-PII before/after snapshots.
 *   3. Already-deleted (idempotent) → 200 { alreadyDeleted: true }; no audit
 *      row inserted.
 *   4. Update DB error → 500; no audit, no signOut.
 *   5. Audit DB error → 500 (anonymization committed already — Slice 1 has
 *      no transactional atomicity; user-visible 500 surfaces the cleanup gap).
 *   6. AC13: audit insert payload's before/after snapshots contain NO PII.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
  adminFrom: vi.fn(),
  profilesUpdate: vi.fn(),
  profilesEq: vi.fn(),
  profilesIs: vi.fn(),
  profilesSelect: vi.fn(),
  profilesMaybeSingle: vi.fn(),
  auditInsert: vi.fn(),
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

vi.mock('server-only', () => ({}));

import { POST } from '@/app/api/privacy/delete/route';

const DELETE_ROUTE_PATH = resolve(__dirname, '../../app/api/privacy/delete/route.ts');
const DELETE_ROUTE_SOURCE = readFileSync(DELETE_ROUTE_PATH, 'utf8');

const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const EXPECTED_HASH = createHash('sha256').update(USER_ID).digest('hex');
const EXPECTED_FULL_NAME = `del:${EXPECTED_HASH}`;
const EXPECTED_EMAIL = `del:${EXPECTED_HASH}@deleted.local`;

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/privacy/delete', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

// Default behavior: profile update returns a single row (success path);
// audit_log insert succeeds.
function wireSupabaseChain(
  opts: {
    maybeSingleResult?: { data: { id: string } | null; error: unknown };
    auditResult?: { error: unknown };
  } = {},
): void {
  const profilesChain = {
    update: mocks.profilesUpdate,
    eq: mocks.profilesEq,
    is: mocks.profilesIs,
    select: mocks.profilesSelect,
    maybeSingle: mocks.profilesMaybeSingle,
  };
  const auditChain = {
    insert: mocks.auditInsert,
  };
  mocks.adminFrom.mockImplementation((table: string) => {
    if (table === 'profiles') return profilesChain;
    if (table === 'audit_log') return auditChain;
    throw new Error(`Unexpected table: ${table}`);
  });
  mocks.profilesUpdate.mockReturnValue(profilesChain);
  mocks.profilesEq.mockReturnValue(profilesChain);
  mocks.profilesIs.mockReturnValue(profilesChain);
  mocks.profilesSelect.mockReturnValue(profilesChain);
  mocks.profilesMaybeSingle.mockResolvedValue(
    opts.maybeSingleResult ?? { data: { id: USER_ID }, error: null },
  );
  mocks.auditInsert.mockResolvedValue(opts.auditResult ?? { error: null });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.signOut.mockResolvedValue({ error: null });
  wireSupabaseChain();
});

describe('POST /api/privacy/delete', () => {
  it('401 when no session; no DB writes', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'No session' } });

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe('unauthorized');
    expect(mocks.profilesUpdate).not.toHaveBeenCalled();
    expect(mocks.auditInsert).not.toHaveBeenCalled();
  });

  it('401 when getUser returns null user with no error', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    expect(mocks.profilesUpdate).not.toHaveBeenCalled();
  });

  it('200 { alreadyDeleted: false } on first delete; calls profiles.update with anonymization tokens AND audit_log.insert', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.alreadyDeleted).toBe(false);

    // profiles.update was called with the deterministic anonymization tokens.
    expect(mocks.profilesUpdate).toHaveBeenCalledTimes(1);
    const updatePayload = mocks.profilesUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updatePayload.full_name).toBe(EXPECTED_FULL_NAME);
    expect(updatePayload.email).toBe(EXPECTED_EMAIL);
    expect(updatePayload.phone).toBeNull();
    expect(typeof updatePayload.deleted_at).toBe('string');
    expect(updatePayload.deleted_at as string).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Anonymization is row-scoped to the session user with idempotency gate.
    expect(mocks.profilesEq).toHaveBeenCalledWith('id', USER_ID);
    expect(mocks.profilesIs).toHaveBeenCalledWith('deleted_at', null);

    // audit_log.insert was called with the right shape.
    expect(mocks.auditInsert).toHaveBeenCalledTimes(1);
    const auditPayload = mocks.auditInsert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(auditPayload.actor_id).toBe(USER_ID);
    expect(auditPayload.action).toBe('privacy.account_deleted');
    expect(auditPayload.target_type).toBe('profile');
    expect(auditPayload.target_id).toBe(USER_ID);

    // Sign-out was called.
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('audit insert payload carries ip + user_agent from request headers', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

    await POST(
      makeRequest({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8', 'user-agent': 'TestBrowser/1.0' }),
    );

    const auditPayload = mocks.auditInsert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(auditPayload.ip).toBe('1.2.3.4');
    expect(auditPayload.user_agent).toBe('TestBrowser/1.0');
  });

  it('200 { alreadyDeleted: true } when update matches no row (idempotent re-delete); audit NOT inserted', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    wireSupabaseChain({ maybeSingleResult: { data: null, error: null } });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.alreadyDeleted).toBe(true);
    expect(mocks.auditInsert).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('500 when update returns an error; no audit, no signOut', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    wireSupabaseChain({
      maybeSingleResult: {
        data: null,
        error: { message: 'DB connection failed: user@db.internal', code: 'PGRST500' },
      },
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe('internal');
    expect(JSON.stringify(body)).not.toMatch(/DB connection failed/);
    expect(mocks.auditInsert).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('500 when update throws; no audit, no signOut', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.profilesMaybeSingle.mockRejectedValue(new Error('network: peer reset internal@db'));

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe('internal');
    expect(JSON.stringify(body)).not.toMatch(/network|internal@/);
    expect(mocks.auditInsert).not.toHaveBeenCalled();
  });

  it('500 when audit insert returns an error (anonymization already committed)', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    wireSupabaseChain({ auditResult: { error: { message: 'audit_log FK violation' } } });

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe('internal');
    // Underlying error not leaked.
    expect(JSON.stringify(body)).not.toMatch(/FK violation/);
    // Profile update DID run (the gap Slice 2 closes).
    expect(mocks.profilesUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/privacy/delete — AC13 no-PII-in-audit guard', () => {
  it('audit_log.insert payload before/after objects contain ONLY deleted_at (no email, full_name, phone)', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

    await POST(makeRequest());

    const auditPayload = mocks.auditInsert.mock.calls[0]?.[0] as Record<string, unknown>;
    const before = auditPayload.before as Record<string, unknown>;
    const after = auditPayload.after as Record<string, unknown>;

    expect(Object.keys(before).sort()).toEqual(['deleted_at']);
    expect(Object.keys(after).sort()).toEqual(['deleted_at']);
    expect(before.deleted_at).toBeNull();
    expect(typeof after.deleted_at).toBe('string');

    const combined = JSON.stringify(before) + JSON.stringify(after);
    expect(combined).not.toMatch(/email/);
    expect(combined).not.toMatch(/full_name/);
    expect(combined).not.toMatch(/phone/);
  });
});

describe('POST /api/privacy/delete — AC13 source-grep guard', () => {
  it('route source does NOT include PII keys inside before/after literals', () => {
    const source = DELETE_ROUTE_SOURCE;

    const beforeIdx = source.indexOf('before: { deleted_at:');
    const afterIdx = source.indexOf('after: { deleted_at:');

    expect(beforeIdx).toBeGreaterThan(-1);
    expect(afterIdx).toBeGreaterThan(-1);

    const beforeSnippet = source.slice(beforeIdx, beforeIdx + 100);
    expect(beforeSnippet).not.toMatch(/email|full_name|phone/);

    const afterSnippet = source.slice(afterIdx, afterIdx + 100);
    expect(afterSnippet).not.toMatch(/email|full_name|phone/);
  });

  it('route source calls adminClient.from("profiles").update with the deterministic SHA-256 token shape', () => {
    const source = DELETE_ROUTE_SOURCE;

    // Anonymization must use a sha256 hex digest of userId — guards against
    // a future "simplification" that uses a random string or empty token.
    expect(source).toMatch(/createHash\(['"]sha256['"]\)/);
    expect(source).toMatch(/\.update\(userId\)\.digest\(['"]hex['"]\)/);
    expect(source).toMatch(/del:\$\{hash\}/);
    expect(source).toMatch(/del:\$\{hash\}@deleted\.local/);

    // The route MUST NOT go through softDeleteProfile in production — that
    // path is reserved for the future pg-driver / pglite test substrate.
    expect(source).not.toMatch(/softDeleteProfile/);
  });
});
