'use client';

/**
 * Error boundary for `/admin/payments/refunds/new` (ADR-0036 Slice 1,
 * spec AC28).
 *
 * Catches `StripeNotConfiguredError` (and any other error) thrown by
 * the `initiateRefund` server action and renders a stable, redaction-
 * safe message.
 *
 * ## Load-bearing render contract (premortem R4 binding)
 *
 * This boundary renders `error.userMessage` — the stable, render-safe
 * literal pinned on `StripeNotConfiguredError` in `lib/payments/_errors.ts`.
 *
 *   - It NEVER renders `error.message`. The class's `message` field is
 *     shaped for SERVER LOGS (cites ADR-0010 + operational context);
 *     rendering it client-side would leak architectural detail
 *     (env-var name structure, stack frames) to anyone who can reach
 *     the form — manager+ only, but still an unintended surface.
 *   - The fallback (when `userMessage` is absent — e.g. a generic
 *     non-Stripe error reaches this boundary) is a stable literal too;
 *     we DELIBERATELY do not fall back to `error.message`.
 *   - The literal "Refund not initiated" is pinned in three places —
 *     class JSDoc (via `userMessage` value), this boundary, and the
 *     RTL test — so drift requires three coordinated edits.
 *
 * Other error types (`InsufficientRoleError`, `InsufficientAuthorityError`,
 * `BadRequest`) fall THROUGH to the parent boundary at
 * `app/(admin)/admin/error.tsx` only if this boundary re-throws. We
 * intentionally do NOT re-throw — rendering a uniform "Refund not
 * initiated" message is the right UX for every failure mode at this
 * surface (a manager who isn't manager+ doesn't reach the action at
 * all; the page-level `requireRole('manager')` redirects to /login
 * first).
 *
 * @see docs/specs/0036-payment-management-console-implementation.md AC28
 * @see lib/payments/_errors.ts — `StripeNotConfiguredError.userMessage`
 * @see .conductor/36/returns/0007-premortem-fail-loud.md R4
 */

import { useEffect } from 'react';

type ErrorWithUserMessage = Error & {
  /** Stable, render-safe literal from `StripeNotConfiguredError`. */
  userMessage?: string;
  /** Next.js framework digest for server-side error grouping. */
  digest?: string;
};

// Fallback copy that does NOT leak `error.message` contents. Pinned as
// a const so a future refactor cannot accidentally interpolate the
// underlying message into a "more helpful" string.
const FALLBACK_USER_MESSAGE =
  'This refund could not be initiated. Please try again or contact the system administrator.';

export default function RefundNewError({
  error,
  reset,
}: {
  error: ErrorWithUserMessage;
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    // Breadcrumb seam for the ADR-0026 observability wiring (Sentry +
    // PostHog scrubber owns redaction). We log ONLY the structural
    // fields — name + digest. We deliberately do NOT include
    // `error.message` here because that string contains the env-var
    // name reference; the scrubber would catch it, but defense in
    // depth is the posture.
    // eslint-disable-next-line no-console -- breadcrumb seam for ADR-0026 wiring; scrubber covers payload.
    console.error('[admin/payments/refunds/new] segment error boundary fired', {
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  // Read the render-safe field. `userMessage` is the ONLY field this
  // boundary ever puts into the DOM. The `?? FALLBACK_USER_MESSAGE`
  // fallback covers errors that lack the field (anything not
  // `StripeNotConfiguredError`). NEVER fall back to `error.message`
  // (premortem R4 binding).
  const userMessage = error.userMessage ?? FALLBACK_USER_MESSAGE;

  return (
    <section
      role="alert"
      aria-live="polite"
      style={{
        maxWidth: 520,
        margin: '80px auto',
        padding: '0 32px',
        textAlign: 'left',
        color: 'var(--ivory-200)',
      }}
    >
      <div
        className="eyebrow"
        style={{
          fontSize: 11,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 12,
        }}
      >
        Admin Console — Payments
      </div>
      <h2
        style={{
          fontFamily: 'Cormorant Garamond, serif',
          fontSize: 36,
          fontWeight: 500,
          lineHeight: 1.1,
          letterSpacing: '-0.015em',
          marginBottom: 16,
        }}
      >
        Refund not initiated
      </h2>
      <p
        style={{
          color: 'var(--ivory-300)',
          fontSize: 15,
          lineHeight: 1.65,
          marginBottom: 32,
        }}
      >
        {userMessage}
      </p>
      <button
        type="button"
        onClick={reset}
        className="btn btn-sm"
        style={{
          padding: '10px 18px',
          border: '1px solid var(--border-faint)',
          background: 'transparent',
          color: 'var(--ivory-200)',
          fontSize: 12,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          borderRadius: 4,
        }}
      >
        Dismiss
      </button>
    </section>
  );
}
