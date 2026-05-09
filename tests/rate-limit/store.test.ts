import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore } from '@/lib/rate-limit/store';

let store: InMemoryStore;

beforeEach(() => {
  store = new InMemoryStore();
});

describe('InMemoryStore — single subject', () => {
  it('allows hits up to the limit', async () => {
    const now = 1_000_000_000_000;
    for (let i = 0; i < 60; i++) {
      const r = await store.hit('anonymous', 'ip:1.2.3.4', now + i);
      expect(r.allowed).toBe(true);
    }
  });

  it('disallows the (limit + 1)-th hit within the window', async () => {
    const now = 1_000_000_000_000;
    for (let i = 0; i < 60; i++) await store.hit('anonymous', 'ip:1.2.3.4', now + i);
    const r = await store.hit('anonymous', 'ip:1.2.3.4', now + 60);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('decrements remaining as hits accumulate', async () => {
    const now = 1_000_000_000_000;
    const r1 = await store.hit('anonymous', 'ip:x', now);
    const r2 = await store.hit('anonymous', 'ip:x', now + 1);
    expect(r1.remaining).toBe(59);
    expect(r2.remaining).toBe(58);
  });

  it('resets after the window passes (sliding behaviour)', async () => {
    const now = 1_000_000_000_000;
    for (let i = 0; i < 60; i++) await store.hit('anonymous', 'ip:y', now + i);
    // 1 second past the window — first hit (at t=now) is now stale.
    const past = now + 60_000 + 1;
    const r = await store.hit('anonymous', 'ip:y', past);
    expect(r.allowed).toBe(true);
  });
});

describe('InMemoryStore — subject isolation', () => {
  it('different subjects have independent buckets', async () => {
    const now = 1_000_000_000_000;
    for (let i = 0; i < 60; i++) await store.hit('anonymous', 'ip:a', now + i);
    const blockedA = await store.hit('anonymous', 'ip:a', now + 60);
    const allowedB = await store.hit('anonymous', 'ip:b', now + 60);
    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });

  it('different bucket keys for the same subject are independent', async () => {
    const now = 1_000_000_000_000;
    for (let i = 0; i < 5; i++) await store.hit('login', 'ip:c', now + i);
    const blockedLogin = await store.hit('login', 'ip:c', now + 5);
    const allowedAnon = await store.hit('anonymous', 'ip:c', now + 5);
    expect(blockedLogin.allowed).toBe(false);
    expect(allowedAnon.allowed).toBe(true);
  });
});

describe('InMemoryStore — Decision shape', () => {
  it('returns valid limit/remaining/reset_at_ms', async () => {
    const now = 1_000_000_000_000;
    const r = await store.hit('login', 'ip:z', now);
    expect(r.limit).toBe(5);
    expect(r.remaining).toBe(4);
    expect(r.reset_at_ms).toBeGreaterThan(now);
    expect(r.reset_at_ms).toBeLessThanOrEqual(now + 15 * 60_000);
  });
});
