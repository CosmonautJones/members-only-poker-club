/**
 * T8 — `<ErrorTrackingGate />` AC8 spy assertion per ADR-0024 + Slice-1
 * spec critic remediation.
 *
 * Wave-3 only asserted that children always render under the gate. The
 * binding contract per AC8 is the SDK-init side effect: 0 calls when
 * `!isLoaded`, 0 when `state.errors === false`, 1 when `state.errors === true`.
 *
 * `lib/sentry/init.ts` exposes `_internals.doSentryInit` as the spy seam
 * (the same seam used by `init-sentry.test.ts` for AC9 idempotency).
 * `__resetSentryInitForTests()` resets the module-level idempotency flag
 * between tests so each test starts from a clean slate.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ConsentProvider } from '@/components/site/consent-provider';
import { ErrorTrackingGate } from '@/components/site/error-tracking-gate';
import * as sentryInit from '@/lib/sentry/init';

beforeEach(() => {
  document.cookie = 'mopc-consent=; Max-Age=0; Path=/';
  sentryInit.__resetSentryInitForTests?.();
});

describe('ErrorTrackingGate calls initSentry conditionally', () => {
  it('does NOT call initSentry when isLoaded=false (initial pre-mount state)', async () => {
    const spy = vi.spyOn(sentryInit._internals, 'doSentryInit').mockImplementation(() => {});
    // Render with no cookie → state remains null after mount
    render(
      <ConsentProvider>
        <ErrorTrackingGate>
          <div />
        </ErrorTrackingGate>
      </ConsentProvider>,
    );
    // Wait a tick for effects
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).toHaveBeenCalledTimes(0); // state is null → errors !== true
    spy.mockRestore();
  });

  it('does NOT call initSentry when consent.errors=false', async () => {
    document.cookie = `mopc-consent=${encodeURIComponent(JSON.stringify({ essential: true, analytics: false, errors: false, version: 1 }))}; Path=/`;
    const spy = vi.spyOn(sentryInit._internals, 'doSentryInit').mockImplementation(() => {});
    render(
      <ConsentProvider>
        <ErrorTrackingGate>
          <div />
        </ErrorTrackingGate>
      </ConsentProvider>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).toHaveBeenCalledTimes(0);
    spy.mockRestore();
  });

  it('calls initSentry exactly once when consent.errors=true', async () => {
    document.cookie = `mopc-consent=${encodeURIComponent(JSON.stringify({ essential: true, analytics: false, errors: true, version: 1 }))}; Path=/`;
    const spy = vi.spyOn(sentryInit._internals, 'doSentryInit').mockImplementation(() => {});
    render(
      <ConsentProvider>
        <ErrorTrackingGate>
          <div />
        </ErrorTrackingGate>
      </ConsentProvider>,
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
