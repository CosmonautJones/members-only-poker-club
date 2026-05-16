import 'server-only';

/**
 * Feature constant for ADR-0035 Open Question 7 — MFA route fallback.
 *
 * `MFA_CHALLENGE_READY` describes whether `/login/mfa-challenge` (owned
 * by ADR-0002 cycle 4 — MFA enrollment + challenge) exists in the
 * deployed app. While `false`, `lib/auth/requireRole.ts` redirects
 * `aal < aal2` manager+ sessions to a static `/login/mfa-pending` page
 * instead. This is a graceful degradation so the admin-console
 * conductor cycle (ADR-0035) is not hard-blocked on the MFA cycle.
 *
 * The constant pattern mirrors `lib/payments/console-availability.ts`'s
 * `PAYMENTS_CONSOLE_READY` — both flip from `false` to `true` exactly
 * once when the downstream slice ships.
 *
 * TODO(adr-0002-cycle-4): when MFA actually ships, flip this to `true`
 * AND either replace `/login/mfa-pending` with HTTP 410 Gone or
 * redirect it to `/login/mfa-challenge`. See ADR-0035 Open Question 7
 * and premortem R13 (the fallback page must not linger after MFA is
 * live — staff trained to call the owner on its sight need a clean
 * deprecation, not a silent behavior swap).
 */
export const MFA_CHALLENGE_READY = false as const;
