/**
 * Flag registry — the source of truth for flag definitions until the
 * DB-backed read path lands. ADR-0020.
 *
 * Adding a new flag:
 *   1. Add the key to the `FlagKey` union in `types.ts`.
 *   2. Add an entry below.
 *   3. Reference it via `isEnabled('your-key')`.
 *
 * Removing a flag (90-day cleanup cadence):
 *   1. If 100%: inline the enabled path; remove the flag check call sites.
 *   2. If 0%: delete the flag-conditional code; remove call sites.
 *   3. Delete the entry here and the key from the union.
 */
import type { FlagDefinition, FlagKey } from './types';

export const FLAGS: Record<FlagKey, FlagDefinition> = {
  // Kill-switch for the Stripe webhook handler. When enabled=false (default),
  // the webhook handler runs normally. Operations toggles to true to halt
  // webhook processing during an incident (e.g., webhook signature rotation,
  // observed double-processing). Kill-switch semantics (per ADR-0020): the
  // *enabled* field is the off switch — set enabled=false to disable the
  // kill (i.e., resume normal operation), and enabled=true to *engage* the
  // kill (i.e., stop webhook processing). The flag code at the call site
  // reads `if (isEnabled('kill-stripe-webhook')) return early;`.
  'kill-stripe-webhook': {
    key: 'kill-stripe-webhook',
    enabled: false,
    percent: 100,
    allowlist: [],
    owner: 'ops',
  },
} as const;
