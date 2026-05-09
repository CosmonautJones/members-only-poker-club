/**
 * Server-side Sentry init — ADR-0014.
 *
 * Mirrors the contract of `lib/sentry/init.ts` for server contexts (API
 * routes, server actions, edge middleware). Reads the server-only
 * `SENTRY_DSN` env var — when unset, this is a silent no-op so the lack of
 * a configured Sentry project is not a runtime error.
 *
 * Idempotency: like the client init, multiple calls within a single
 * module lifetime invoke the underlying init exactly once.
 */
import * as Sentry from '@sentry/nextjs';
import type { ErrorEvent } from '@sentry/nextjs';
import { redactPii } from '@/lib/observability/redact';

let initialized = false;

export const _internals = {
  doServerInit(): void {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) return;
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1, // ADR-0014 sampling
      profilesSampleRate: 0.1,
      beforeSend(event: ErrorEvent): ErrorEvent {
        // Redact PII from extras / contexts / breadcrumbs / request bodies
        // before the event leaves our process.
        if (event.extra) {
          event.extra = redactPii(event.extra) as Record<string, unknown>;
        }
        if (event.contexts) {
          event.contexts = redactPii(event.contexts) as typeof event.contexts;
        }
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map(
            (b) => redactPii(b) as (typeof event.breadcrumbs)[number],
          );
        }
        if (event.request?.data) {
          event.request.data = redactPii(event.request.data);
        }
        return event;
      },
    });
  },
};

export function initSentryServer(): void {
  if (initialized) return;
  initialized = true;
  _internals.doServerInit();
}

/** Test-only reset for the idempotency flag. */
export function __resetSentryServerInitForTests(): void {
  initialized = false;
}
