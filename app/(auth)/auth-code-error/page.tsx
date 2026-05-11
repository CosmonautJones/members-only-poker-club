/**
 * `/auth-code-error` — generic verification-failure landing (ADR-0002, AC4).
 *
 * Server component, static. Reached when `/confirm` cannot exchange the
 * `token_hash` (missing params, expired, replayed, wrong type). Kept
 * intentionally generic so we don't leak whether the link was expired vs.
 * invalid vs. already-used. Points the user at `/forgot-password` to
 * request a fresh link, which is the safe action regardless of cause.
 */

export default function AuthCodeErrorPage() {
  return (
    <div>
      <h1>We couldn&apos;t verify that link.</h1>
      <p>
        The link may be expired or already used. <a href="/forgot-password">Request a new one</a>.
      </p>
    </div>
  );
}
