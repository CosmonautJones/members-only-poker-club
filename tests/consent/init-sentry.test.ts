/**
 * T6 / T8 — AC9 idempotency assertion for `initSentry()`.
 *
 * The wave-3 bundle only proved `initSentry()` does not throw on repeat
 * calls. AC9 demands a stronger contract: the underlying init body must
 * run exactly once across N invocations within a single module lifetime.
 *
 * `lib/sentry/init.ts` exposes an `_internals.doSentryInit` seam for this
 * purpose. We `vi.spyOn(_internals, 'doSentryInit')` and then assert
 * call count after N `initSentry()` calls.
 *
 * `__resetSentryInitForTests()` resets the module-level idempotency flag
 * between tests so the contract can be re-tested in isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as sentryInit from '@/lib/sentry/init';

beforeEach(() => {
  sentryInit.__resetSentryInitForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  sentryInit.__resetSentryInitForTests();
});

describe('initSentry — idempotency (AC9)', () => {
  it('runs the underlying init exactly once across multiple calls', () => {
    const spy = vi.spyOn(sentryInit._internals, 'doSentryInit');

    sentryInit.initSentry();
    sentryInit.initSentry();
    sentryInit.initSentry();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('runs again after __resetSentryInitForTests', () => {
    sentryInit.initSentry();
    sentryInit.initSentry();

    sentryInit.__resetSentryInitForTests();

    const spy = vi.spyOn(sentryInit._internals, 'doSentryInit');
    sentryInit.initSentry();
    sentryInit.initSentry();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not throw when called many times', () => {
    expect(() => {
      for (let i = 0; i < 100; i += 1) {
        sentryInit.initSentry();
      }
    }).not.toThrow();
  });

  it('exports the _internals seam for ADR-0014 to fill in', () => {
    expect(typeof sentryInit._internals).toBe('object');
    expect(typeof sentryInit._internals.doSentryInit).toBe('function');
  });
});
