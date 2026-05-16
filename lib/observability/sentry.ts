import 'server-only';

/**
 * Admin-surface Sentry helpers — ADR-0035 AC32 + ADR-0014.
 *
 * Three exports:
 *   - `withAdminScope(fn)` runs `fn` inside a Sentry scope pre-tagged
 *     `surface=admin`, giving server-action callers a place to add
 *     per-action tags (`action=<name>`, `actor_role=<role>`) without
 *     ever attaching email or other PII.
 *   - `captureAdminActionError(err, { action, actorRole })` is the
 *     convenience wrapper for server-action catch blocks: it tags
 *     `surface=admin`, `action=<action>`, `actor_role=<role>` and
 *     calls `Sentry.captureException(err)`.
 *   - `ADMIN_REDACTED_KEYS` + `redactAdminEventKeys(event)` — the
 *     single source-of-truth for admin-surface free-text fields that
 *     must NOT leave the process: `reject_reason`,
 *     `info_request_message`, `requester_email`. The Sentry
 *     `beforeSend` hook (see `instrumentation.ts` /
 *     `lib/sentry/server-init.ts`) calls `redactAdminEventKeys` to
 *     strip these from `event.extra`, `event.tags`, and
 *     `event.contexts.*` before the event leaves our process.
 *
 * Defensive design: every Sentry interaction is wrapped in try/catch
 * and falls back to a no-op stub if the SDK is unavailable or throws.
 * The helper MUST never escape an observability error into the caller's
 * control flow — observability failures are silent.
 *
 * ADR-0014 PII redaction list (`lib/observability/redact.ts`) handles
 * `email`, `phone`, `dob`, etc. by key pattern. The three admin keys
 * here are NOT in that pattern list (they're admin-domain-specific
 * staff-authored free-text), so this module supplies the deny-list
 * for them. ADR-0014's redactor still runs first in `beforeSend`;
 * `redactAdminEventKeys` is the second pass that catches the
 * admin-specific keys.
 */

import * as Sentry from '@sentry/nextjs';

/**
 * Minimal scope shape used by `withAdminScope`. Kept narrow so the
 * helper can be backed by either the real Sentry `Scope` or a no-op
 * stub. The `setTag` method matches `@sentry/nextjs`'s `Scope.setTag`.
 */
export interface AdminScope {
  setTag(key: string, value: string): void;
  setExtra(key: string, value: unknown): void;
}

const NOOP_SCOPE: AdminScope = {
  setTag() {
    /* no-op */
  },
  setExtra() {
    /* no-op */
  },
};

/**
 * Admin-surface free-text fields that must be redacted from any Sentry
 * event payload. Source-of-truth for `beforeSend` and for AC32 test
 * coverage. These are staff-authored text fields that may contain PII
 * by reference (e.g. a reject reason that quotes the member's name).
 */
export const ADMIN_REDACTED_KEYS = [
  'reject_reason',
  'info_request_message',
  'requester_email',
] as const;

export type AdminRedactedKey = (typeof ADMIN_REDACTED_KEYS)[number];

const REDACTED_PLACEHOLDER = '[REDACTED]' as const;

/**
 * Recursively walk a value tree and replace any property whose key is
 * in `ADMIN_REDACTED_KEYS` with `'[REDACTED]'`. Arrays are walked
 * element-wise; primitives pass through; cycles are guarded.
 *
 * Exported as a separate function (not folded into the Sentry
 * `beforeSend` body) so the AC32 test can unit-test it directly.
 */
export function redactAdminKeys(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactAdminKeys(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if ((ADMIN_REDACTED_KEYS as readonly string[]).includes(key)) {
      out[key] = REDACTED_PLACEHOLDER;
    } else {
      out[key] = redactAdminKeys(v, seen);
    }
  }
  return out;
}

/**
 * `beforeSend` hook wing for admin-redacted keys. Pass a Sentry event
 * (any shape with `extra`, `tags`, `contexts`) and receive a new event
 * with `ADMIN_REDACTED_KEYS` redacted from each. Non-mutating:
 * returns a shallow-merged event so callers can compose hooks.
 *
 * Typed loosely (`unknown` in / `unknown` out) because Sentry's
 * `ErrorEvent` type evolves between SDK majors — we only depend on
 * the three property names.
 */
export function redactAdminEventKeys<E extends Record<string, unknown>>(event: E): E {
  const next: Record<string, unknown> = { ...event };
  if (event.extra !== undefined) {
    next.extra = redactAdminKeys(event.extra);
  }
  if (event.tags !== undefined) {
    next.tags = redactAdminKeys(event.tags);
  }
  if (event.contexts !== undefined) {
    next.contexts = redactAdminKeys(event.contexts);
  }
  return next as E;
}

/**
 * Run `fn` inside a Sentry scope pre-tagged `surface=admin`. The
 * scope is passed to `fn` so callers can attach per-action tags. If
 * Sentry's `withScope` throws or the SDK is unavailable, the function
 * still runs with a no-op scope — observability errors never break
 * the caller's control flow.
 *
 * Generic over `T` so the return type passes through cleanly. `fn`
 * may return either a value or a Promise.
 */
export async function withAdminScope<T>(fn: (scope: AdminScope) => Promise<T> | T): Promise<T> {
  // Hoist a place to capture the caller's return value across the
  // Sentry `withScope` callback boundary.
  let resultPromise: Promise<T> | undefined;
  let bypass = false;
  try {
    Sentry.withScope((scope) => {
      try {
        scope.setTag('surface', 'admin');
      } catch {
        /* swallow tag failures — observability is best-effort */
      }
      const adapter: AdminScope = {
        setTag(key, value) {
          try {
            scope.setTag(key, value);
          } catch {
            /* no-op */
          }
        },
        setExtra(key, value) {
          try {
            scope.setExtra(key, value);
          } catch {
            /* no-op */
          }
        },
      };
      // Wrap in Promise.resolve so synchronous returns become awaitable.
      resultPromise = Promise.resolve(fn(adapter));
    });
  } catch {
    bypass = true;
  }
  if (bypass || resultPromise === undefined) {
    // Sentry not available or threw — run the callback with a no-op
    // scope so the caller's logic still executes.
    return await Promise.resolve(fn(NOOP_SCOPE));
  }
  return await resultPromise;
}

/**
 * Capture a server-action exception with admin-surface tags.
 *
 * Tags set: `surface=admin`, `action=<action>`, `actor_role=<role>`.
 * Email and other PII are NEVER tagged — ADR-0014's PII redaction
 * list (lib/observability/redact.ts) is the source-of-truth for
 * what may not appear in tags/extras. `actor_role` is intentionally
 * coarse (e.g. `manager`, `cashier`) and not the actor's identity.
 *
 * Falls back to a no-op if the Sentry SDK is unavailable or throws.
 */
export function captureAdminActionError(
  err: unknown,
  opts: { action: string; actorRole: string },
): void {
  try {
    Sentry.withScope((scope) => {
      try {
        scope.setTag('surface', 'admin');
        scope.setTag('action', opts.action);
        scope.setTag('actor_role', opts.actorRole);
      } catch {
        /* no-op — keep going so the exception is still captured */
      }
      try {
        Sentry.captureException(err);
      } catch {
        /* no-op — observability is best-effort */
      }
    });
  } catch {
    /* SDK absent or threw on `withScope` — degrade silently */
  }
}
