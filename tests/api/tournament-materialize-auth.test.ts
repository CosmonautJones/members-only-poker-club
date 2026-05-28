/**
 * Auth tests for the tournament materializer cron route (ADR-0037).
 *
 * Spec: `Authorization: Bearer ${CRON_SECRET}` required; anything else → 401.
 *
 * Mocks `createAdminClient` so the auth check is exercised without spinning
 * up a real Supabase client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  runMaterialize: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('@/lib/tournaments/materialize-run', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tournaments/materialize-run')>(
    '@/lib/tournaments/materialize-run',
  );
  return {
    ...actual,
    runMaterialize: mocks.runMaterialize,
  };
});

import { GET } from '@/app/api/cron/tournament-materialize/route';

const makeReq = (headers: Record<string, string> = {}): NextRequest => {
  const req = new NextRequest(new URL('/api/cron/tournament-materialize', 'http://localhost'));
  for (const [k, v] of Object.entries(headers)) {
    req.headers.set(k, v);
  }
  return req;
};

beforeEach(() => {
  mocks.createAdminClient.mockReset();
  mocks.runMaterialize.mockReset();
});

describe('GET /api/cron/tournament-materialize — auth', () => {
  it('rejects with 401 when no Authorization header is present', async () => {
    process.env['CRON_SECRET'] = 'test-secret';
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.runMaterialize).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the Bearer secret does not match', async () => {
    process.env['CRON_SECRET'] = 'test-secret';
    const res = await GET(makeReq({ authorization: 'Bearer wrong-secret' }));
    expect(res.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects with 401 when CRON_SECRET env is unset (misconfig refuses by default)', async () => {
    delete process.env['CRON_SECRET'];
    const res = await GET(makeReq({ authorization: 'Bearer test-secret' }));
    expect(res.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('passes through to runMaterialize on a matching Bearer header (200)', async () => {
    process.env['CRON_SECRET'] = 'test-secret';
    const summary = {
      created: 5,
      skipped_existing: 0,
      skipped_dst_gap: 0,
      errors: 0,
      templates_processed: 4,
      templates_skipped_inactive: 0,
    };
    mocks.createAdminClient.mockReturnValue({} as never);
    mocks.runMaterialize.mockResolvedValue(summary);

    const res = await GET(makeReq({ authorization: 'Bearer test-secret' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, summary });
    expect(mocks.runMaterialize).toHaveBeenCalledTimes(1);
  });

  it('returns 500 (not 401) when the materializer itself throws', async () => {
    process.env['CRON_SECRET'] = 'test-secret';
    mocks.createAdminClient.mockReturnValue({} as never);
    mocks.runMaterialize.mockRejectedValue(new Error('db down'));

    const res = await GET(makeReq({ authorization: 'Bearer test-secret' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('materialize_failed');
    expect(body.detail).toContain('db down');
  });
});
