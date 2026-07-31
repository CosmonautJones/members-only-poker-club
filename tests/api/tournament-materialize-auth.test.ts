import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  runMaterialize: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/postgres-transaction-runner', () => ({
  postgresTransactionRunner: {
    transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/tournaments/materialize-run', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tournaments/materialize-run')>(
    '@/lib/tournaments/materialize-run',
  );
  return { ...actual, runMaterialize: mocks.runMaterialize };
});

import { GET } from '@/app/api/cron/tournament-materialize/route';

function request(headers: Record<string, string> = {}): NextRequest {
  const value = new NextRequest(new URL('/api/cron/tournament-materialize', 'http://localhost'));
  for (const [name, content] of Object.entries(headers)) value.headers.set(name, content);
  return value;
}

beforeEach(() => {
  mocks.runMaterialize.mockReset();
  mocks.transaction.mockReset();
  mocks.transaction.mockImplementation(async (work) =>
    work({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
  );
});

describe('GET /api/cron/tournament-materialize authorization', () => {
  it.each([
    ['missing header', 'test-secret', undefined],
    ['wrong secret', 'test-secret', 'Bearer wrong'],
    ['missing configuration', undefined, 'Bearer test-secret'],
  ])('returns 401 for %s before opening a transaction', async (_label, secret, header) => {
    if (secret) process.env['CRON_SECRET'] = secret;
    else delete process.env['CRON_SECRET'];

    const response = await GET(request(header ? { authorization: header } : {}));

    expect(response.status).toBe(401);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.runMaterialize).not.toHaveBeenCalled();
  });

  it('runs the materializer through one transaction on a valid secret', async () => {
    process.env['CRON_SECRET'] = 'test-secret';
    const summary = {
      created: 5,
      skipped_existing: 0,
      skipped_dst_gap: 0,
      errors: 0,
      templates_processed: 4,
      templates_skipped_inactive: 0,
    };
    mocks.runMaterialize.mockResolvedValue(summary);

    const response = await GET(request({ authorization: 'Bearer test-secret' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, summary });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.runMaterialize).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the materializer transaction rolls back', async () => {
    process.env['CRON_SECRET'] = 'test-secret';
    mocks.transaction.mockRejectedValue(new Error('audit insert failed'));

    const response = await GET(request({ authorization: 'Bearer test-secret' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'materialize_failed',
      detail: 'audit insert failed',
    });
  });
});
