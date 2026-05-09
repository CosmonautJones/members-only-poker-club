'use client';

/**
 * T6 — `<ErrorTrackingGate />` per ADR-0024 + Slice-1 spec AC8.
 *
 * Calls `initSentry()` from `lib/sentry/init.ts` inside a `useEffect` only
 * when `isLoaded && state?.errors === true`. Renders `{children}` regardless
 * (the gate is for SDK initialization, not children visibility — concern 6).
 *
 * Idempotency is enforced by the module-level flag in `lib/sentry/init.ts`,
 * so any extra effect runs (StrictMode, re-mounts) cannot double-init the
 * SDK once ADR-0014 ratifies.
 */

import { useEffect } from 'react';

import { useConsent } from './consent-provider';
import { initSentry } from '@/lib/sentry/init';

export function ErrorTrackingGate({ children }: { children: React.ReactNode }) {
  const { state, isLoaded } = useConsent();
  useEffect(() => {
    if (isLoaded && state?.errors === true) {
      initSentry();
    }
  }, [isLoaded, state]);
  return <>{children}</>;
}
