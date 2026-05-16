/**
 * Next.js instrumentation entrypoint — ADR-0014 + ADR-0035 AC32.
 *
 * Next.js calls `register()` exactly once per server runtime
 * (nodejs / edge). We use it to:
 *
 *   1. Initialize Sentry server-side (`lib/sentry/server-init.ts`),
 *      which is idempotent and a silent no-op when `SENTRY_DSN` is
 *      unset. This preserves the existing ADR-0014 `beforeSend`
 *      hook that strips email/phone/dob etc. from event payloads.
 *
 *   2. Register a global event processor that strips
 *      ADR-0035 §Observability admin-surface free-text fields
 *      (`reject_reason`, `info_request_message`, `requester_email`)
 *      from `event.extra`, `event.tags`, and `event.contexts.*`.
 *      These are staff-authored free-text that may quote member
 *      PII by reference — ADR-0014's key-pattern redactor does
 *      not catch them, so AC32 mandates this second pass.
 *
 * Defensive: every Sentry interaction is wrapped in try/catch so a
 * misconfigured DSN or absent SDK does not crash the build or boot.
 *
 * Edge runtime is checked first — only nodejs runtime calls
 * `initSentryServer()`. Edge gets the event-processor wiring too so
 * any captures from the edge runtime are redacted.
 */

export async function register(): Promise<void> {
  try {
    const Sentry = await import('@sentry/nextjs');
    const { redactAdminEventKeys } = await import('@/lib/observability/sentry');

    if (process.env.NEXT_RUNTIME === 'nodejs') {
      const { initSentryServer } = await import('@/lib/sentry/server-init');
      initSentryServer();
    }

    // Register a global event processor that applies the admin-key
    // deny-list to every outgoing event. Runs after the per-init
    // `beforeSend` so ADR-0014's redactor sees the original event
    // first; this second pass catches admin-surface free-text.
    try {
      Sentry.addEventProcessor((event) => {
        try {
          return redactAdminEventKeys(event as unknown as Record<string, unknown>);
        } catch {
          // If redaction throws unexpectedly, drop the event rather
          // than emit raw PII. Sentry treats `null` as "discard".
          return null;
        }
      });
    } catch {
      // Sentry not initialized (no DSN) — addEventProcessor is a
      // no-op anyway, but some SDK versions throw if called pre-init.
      // Silent degradation is fine: no events are emitted either way.
    }
  } catch {
    // `@sentry/nextjs` or the helper module failed to load. Sentry is
    // optional — never break the build because observability is missing.
  }
}
