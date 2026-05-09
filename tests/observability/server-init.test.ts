import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as serverInit from '@/lib/sentry/server-init';

beforeEach(() => {
  serverInit.__resetSentryServerInitForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  serverInit.__resetSentryServerInitForTests();
});

describe('initSentryServer / idempotency', () => {
  it('runs the underlying init exactly once across multiple calls', () => {
    const spy = vi.spyOn(serverInit._internals, 'doServerInit');
    serverInit.initSentryServer();
    serverInit.initSentryServer();
    serverInit.initSentryServer();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('runs again after __resetSentryServerInitForTests', () => {
    serverInit.initSentryServer();
    serverInit.__resetSentryServerInitForTests();
    const spy = vi.spyOn(serverInit._internals, 'doServerInit');
    serverInit.initSentryServer();
    serverInit.initSentryServer();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not throw when SENTRY_DSN is unset', () => {
    const original = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    try {
      expect(() => serverInit.initSentryServer()).not.toThrow();
    } finally {
      if (original !== undefined) process.env.SENTRY_DSN = original;
    }
  });
});
