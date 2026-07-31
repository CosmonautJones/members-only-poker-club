import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransactionRunner } from '@/lib/db/transactions';

const USER_ID = '54bfa783-00be-42ec-8270-2c2b6107ddea';

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: auth.createClient,
}));

import { deleteAccount } from '@/app/api/privacy/delete/route';

interface State {
  deletedAt: string | null;
  fullName: string;
  email: string;
  phone: string | null;
  audits: Array<Record<string, unknown>>;
}

function atomicRunner(
  state: State,
  options: { failMutation?: boolean; failAudit?: boolean } = {},
): TransactionRunner {
  return {
    async transaction(work) {
      const draft = structuredClone(state);
      const result = await work({
        async query(sql, params = []) {
          if (/^UPDATE\s+profiles/i.test(sql.trim())) {
            if (options.failMutation) throw new Error('profile update failed');
            if (draft.deletedAt !== null) return { rows: [] };
            draft.fullName = params[1] as string;
            draft.email = params[2] as string;
            draft.phone = null;
            draft.deletedAt = params[3] as string;
            return { rows: [{ id: USER_ID }] };
          }

          if (/^INSERT\s+INTO\s+audit_log/i.test(sql.trim())) {
            if (options.failAudit) throw new Error('audit insert failed');
            draft.audits.push({
              actor_id: params[0],
              action: params[1],
              target_type: params[2],
              target_id: params[3],
              before: JSON.parse(params[4] as string),
              after: JSON.parse(params[5] as string),
              ip: params[6],
              user_agent: params[7],
            });
            return { rows: [] };
          }

          throw new Error(`unexpected SQL: ${sql}`);
        },
      });
      Object.assign(state, draft);
      return result;
    },
  };
}

function request(): Request {
  return new Request('http://localhost/api/privacy/delete', {
    method: 'POST',
    headers: {
      'x-forwarded-for': '1.2.3.4, 10.0.0.1',
      'user-agent': 'TestBrowser/1.0',
    },
  });
}

function initialState(): State {
  return {
    deletedAt: null,
    fullName: 'Member Name',
    email: 'member@example.com',
    phone: '+15555550123',
    audits: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.createClient.mockReturnValue({ auth: { getUser: auth.getUser, signOut: auth.signOut } });
  auth.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
});

describe('POST /api/privacy/delete', () => {
  it('rejects missing or invalid sessions before opening a transaction', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const state = initialState();

    const response = await deleteAccount(request(), atomicRunner(state));

    expect(response.status).toBe(401);
    expect(state.deletedAt).toBeNull();
    expect(state.audits).toHaveLength(0);
  });

  it('anonymizes and writes the PII-free audit row in one transaction', async () => {
    const state = initialState();
    const response = await deleteAccount(request(), atomicRunner(state));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, alreadyDeleted: false });
    const hash = createHash('sha256').update(USER_ID).digest('hex');
    expect(state.fullName).toBe(`del:${hash}`);
    expect(state.email).toBe(`del:${hash}@deleted.local`);
    expect(state.phone).toBeNull();
    expect(state.deletedAt).toEqual(expect.any(String));
    expect(state.audits).toEqual([
      {
        actor_id: USER_ID,
        action: 'privacy.account_deleted',
        target_type: 'profile',
        target_id: USER_ID,
        before: { deleted_at: null },
        after: { deleted_at: state.deletedAt },
        ip: '1.2.3.4',
        user_agent: 'TestBrowser/1.0',
      },
    ]);
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('is idempotent and writes no second audit row', async () => {
    const state = initialState();
    state.deletedAt = '2026-01-01T00:00:00.000Z';

    const response = await deleteAccount(request(), atomicRunner(state));

    expect(await response.json()).toEqual({ ok: true, alreadyDeleted: true });
    expect(state.audits).toHaveLength(0);
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('writes no audit when the profile mutation fails', async () => {
    const state = initialState();

    const response = await deleteAccount(request(), atomicRunner(state, { failMutation: true }));

    expect(response.status).toBe(500);
    expect(state.deletedAt).toBeNull();
    expect(state.audits).toHaveLength(0);
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('rolls the anonymization back when the audit insert fails', async () => {
    const state = initialState();

    const response = await deleteAccount(request(), atomicRunner(state, { failAudit: true }));

    expect(response.status).toBe(500);
    expect(state).toEqual(initialState());
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

describe('POST /api/privacy/delete source contract', () => {
  it('uses the production runner and keeps audit snapshots limited to deleted_at', () => {
    const source = readFileSync(
      resolve(__dirname, '..', '..', 'app', 'api', 'privacy', 'delete', 'route.ts'),
      'utf8',
    );

    expect(source).toContain('db: TransactionRunner = postgresTransactionRunner');
    expect(source).toContain('JSON.stringify({ deleted_at: null })');
    expect(source).toContain('JSON.stringify({ deleted_at: deletedAt })');
    expect(source).not.toMatch(/JSON\.stringify\(\{[^}]*\b(?:email|full_name|phone)\b[^}]*\}\)/);
  });
});
