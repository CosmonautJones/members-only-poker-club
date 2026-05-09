/**
 * `track()` API — ADR-0028.
 *
 * Client-side `track` is gated by ADR-0024 consent: events are dropped
 * silently when `analytics` consent is null or false. The ADR-0028
 * "buffer until consent" path is acknowledged but deferred to the
 * PostHog-init slice — the right place for it is the driver layer (the
 * PostHog client SDK has a built-in opt-in/opt-out model that we use), not
 * a hand-rolled queue here.
 *
 * Server-side `trackServer` is not subject to the browser consent gate —
 * it cannot read browser cookies and PII redaction per ADR-0014 happens at
 * the driver level. Server callers must still respect their own legal
 * basis for processing (e.g., the cashier-redeem event is processed under
 * legitimate-interest for service-delivery, not consent).
 */
import { readConsent } from '@/lib/consent/cookie';
import { getDriver } from './driver';
import type { Events } from './events';

/**
 * Client-side track. Reads consent from the cookie; drops the event if
 * analytics consent is not granted.
 *
 * Safe to call from server components — when `document` is undefined,
 * `readConsent()` returns null and the event is dropped (analytics-consent
 * is a browser-only signal). Server-side analytics goes through
 * `trackServer` which has its own gate.
 */
export function track(event: Events): void {
  const consent = readConsent();
  if (!consent || !consent.analytics) return;
  getDriver().capture(event);
}

/**
 * Server-side track. Always forwards; not subject to the browser consent
 * gate. Callers must ensure their own legal basis for processing.
 */
export function trackServer(event: Events): void {
  getDriver().capture(event);
}

/**
 * Identify a profile to the analytics layer. Same consent rules as
 * `track`: client-side drops when consent is not granted.
 */
export function identify(profileId: string, traits?: Record<string, unknown>): void {
  const consent = readConsent();
  if (!consent || !consent.analytics) return;
  getDriver().identify(profileId, traits);
}
