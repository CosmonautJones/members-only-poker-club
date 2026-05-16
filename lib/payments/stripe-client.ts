import 'server-only';

import { StripeNotConfiguredError } from '@/lib/payments/_errors';

/**
 * Stripe boundary shells — Slice 1 of ADR-0036.
 *
 * Slice 1 ships every payment-management-console surface in a
 * "fail-loud" posture: every code path that would reach Stripe instead
 * throws `StripeNotConfiguredError`. Slice 2 of ADR-0010 (Stripe
 * activation) replaces the throw sites with real SDK calls — no UI
 * rewrite needed.
 *
 * Both exports live behind `import 'server-only'`: secret keys are
 * server-only per ADR-0007, and the `stripe` Node SDK is never bundled
 * into a client.
 *
 * The env var is `STRIPE_SECRET_KEY` — there is intentionally NO
 * `NEXT_PUBLIC_STRIPE_*` form because the boundary is server-only.
 * Worker confirmed no `NEXT_PUBLIC_STRIPE_*` exists in next.config or
 * .env files at task entry (per task t7 spec Open Q4 resolution).
 */

const STRIPE_SECRET_KEY_ENV = 'STRIPE_SECRET_KEY' as const;

/**
 * Throws `StripeNotConfiguredError` when `STRIPE_SECRET_KEY` is unset,
 * empty, or whitespace-only. Returns `void` (no value) on success.
 *
 * "Whitespace-only" is treated as unset because a `.env` line of
 * `STRIPE_SECRET_KEY=` (trailing space) is the canonical mis-paste a
 * human makes when copying a key from the Stripe dashboard.
 *
 * Slice 2 of ADR-0010 may extend this to validate the key PREFIX (e.g.
 * `sk_test_` vs `sk_live_`); Slice 1 stops at presence + non-empty.
 */
export function assertStripeConfigured(): void {
  const value = process.env[STRIPE_SECRET_KEY_ENV];
  if (value === undefined || value === null || value.trim() === '') {
    throw new StripeNotConfiguredError(STRIPE_SECRET_KEY_ENV);
  }
}

/**
 * Returns a configured Stripe client.
 *
 * Slice 1 stub: ALWAYS throws `StripeNotConfiguredError`. The return
 * type is `never` so TypeScript flags any caller that tries to use the
 * (non-existent) returned value as a Stripe client.
 *
 * Slice 2 of ADR-0010 replaces the body with
 * `return new Stripe(key, { apiVersion: '...' })` — at which point the
 * return type widens to `Stripe`. Callers in Slice 1 must therefore
 * NOT assign the return value to anything (the `never` type makes this
 * a compile error if they try).
 *
 * The throw is unconditional — it ignores `process.env.STRIPE_SECRET_KEY`
 * entirely so Slice 1 cannot accidentally "work" if a developer
 * happens to have the env set locally. Fail-loud is the whole posture.
 */
export function getStripeClient(): never {
  throw new StripeNotConfiguredError(STRIPE_SECRET_KEY_ENV);
}
