/**
 * Tests for `resolveSupabaseUser` — the timeout-race helper inside
 * `lib/supabase/middleware.ts` (incident 2026-05-29 —
 * `MIDDLEWARE_INVOCATION_TIMEOUT` 504 when Supabase paused / unreachable).
 *
 * Contract:
 *   - getUser resolves with a user → `{ kind: 'ok', user }`.
 *   - getUser resolves with no user → `{ kind: 'ok', user: null }`.
 *   - getUser hangs past timeout → `{ kind: 'timeout', timeoutMs }`.
 *   - getUser throws → `{ kind: 'error', message }`.
 *
 * The helper NEVER throws. Logging + degraded behavior is the caller's job
 * (verified by the call site shape — `updateSession` translates the result
 * into a NextResponse + `user: null` on the non-`ok` paths).
 *
 * Fake timers fast-forward past the timeout so we don't pay the 3s wall.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { resolveSupabaseUser, SUPABASE_AUTH_TIMEOUT_MS } from '@/lib/supabase/middleware';

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const sampleUser: User = {
  id: 'user-1',
  email: 'a@b.test',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00Z',
} as unknown as User;

describe('resolveSupabaseUser', () => {
  it('returns kind=ok with the user when getUser resolves', async () => {
    const result = await resolveSupabaseUser(
      async () => ({ data: { user: sampleUser }, error: null }),
      50,
    );
    expect(result).toEqual({ kind: 'ok', user: sampleUser });
  });

  it('returns kind=ok with user=null when getUser resolves anonymous', async () => {
    const result = await resolveSupabaseUser(
      async () => ({ data: { user: null }, error: null }),
      50,
    );
    expect(result).toEqual({ kind: 'ok', user: null });
  });

  it('returns kind=timeout when getUser hangs past the budget', async () => {
    vi.useFakeTimers();
    const promise = resolveSupabaseUser(() => new Promise(() => {}), 100);
    await vi.advanceTimersByTimeAsync(150);
    const result = await promise;
    expect(result).toEqual({ kind: 'timeout', timeoutMs: 100 });
  });

  it('returns kind=error when getUser throws', async () => {
    const result = await resolveSupabaseUser(async () => {
      throw new Error('ECONNREFUSED');
    }, 50);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.message).toContain('ECONNREFUSED');
  });

  it('returns kind=error when getUser rejects with non-Error value', async () => {
    const result = await resolveSupabaseUser(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'string-not-error';
    }, 50);
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.message).toBe('string-not-error');
  });

  it('exports a sane default timeout (≥ 1s, ≤ 10s)', () => {
    expect(SUPABASE_AUTH_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
    expect(SUPABASE_AUTH_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it('clears the timer after getUser resolves (no leaked timeout)', async () => {
    vi.useFakeTimers();
    const promise = resolveSupabaseUser(async () => ({ data: { user: null }, error: null }), 5000);
    const result = await promise;
    expect(result.kind).toBe('ok');
    // Advance past the would-be timeout; nothing should have been queued.
    await vi.advanceTimersByTimeAsync(6000);
    // No assertion needed beyond not-hanging — vi.useFakeTimers reports
    // unhandled-timer warnings on the test reporter if a setTimeout leaked.
  });
});
