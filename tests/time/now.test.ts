/**
 * Unit tests for `nowUtc()` — ADR-0034 Slice 1 AC2 (sub-case group "nowUtc").
 *
 * The helper is the SOLE sanctioned `new Date()` call site outside of
 * test code; these tests pin the wall-clock with `vi.useFakeTimers()` so
 * the assertions are deterministic regardless of when CI runs them.
 *
 * Tests under `tests/**` are in the ESLint `no-restricted-syntax`
 * override glob (t6) — `new Date(<iso-literal>)` here is permitted for
 * fixture construction.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nowUtc } from '@/lib/time';

const PINNED = '2026-05-11T12:34:56.789Z';

describe('nowUtc()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(PINNED));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.TZ;
  });

  it("returned Date's internal value equals vi-set instant", () => {
    const d = nowUtc();
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).toBe(new Date(PINNED).getTime());
    expect(d.toISOString()).toBe(PINNED);
  });

  it('returns a new instance on every call (no memoization)', () => {
    const a = nowUtc();
    const b = nowUtc();
    // Same wall-clock instant under fake timers, but distinct Date
    // instances — the helper must never cache.
    expect(a).not.toBe(b);
    expect(a.getTime()).toBe(b.getTime());
  });

  it("is invariant to the caller's process.env.TZ", () => {
    const baseline = nowUtc().getTime();
    process.env.TZ = 'America/Los_Angeles';
    const shifted = nowUtc().getTime();
    // The Date instance's internal value is UTC ms since epoch; the
    // host TZ only affects presentation via `toString()`, never the
    // instant the helper returns.
    expect(shifted).toBe(baseline);
    expect(nowUtc().toISOString()).toBe(PINNED);
  });
});
