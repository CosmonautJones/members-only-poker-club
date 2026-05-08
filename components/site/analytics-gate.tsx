'use client';

/**
 * T5 — `<AnalyticsGate />` per ADR-0024 + Slice-1 spec AC7.
 *
 * Structural placeholder pending ADR-0028 (PostHog). The gate is real and
 * tested today — `<PostHogProvider>` plugs in here when ADR-0028 ratifies.
 *
 * Per concern 6's pinned contract: this gate exposes consent state via
 * `useConsent()` rather than its own private API, so 0028's slice does not
 * have to retrofit anything when it lands.
 */

import { useConsent } from './consent-provider';

export function AnalyticsGate({ children }: { children: React.ReactNode }) {
  const { state, isLoaded } = useConsent();
  if (!isLoaded || state?.analytics !== true) return null;
  // TODO(adr-0028): wrap children in <PostHogProvider> once ADR-0028 ratifies.
  // The PostHogProvider receives posthog_key + host from env at the call site,
  // not via props through this gate.
  return <>{children}</>;
}
