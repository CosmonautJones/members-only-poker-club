/**
 * Canonical audit-action verb constants per ADR-0006 + ADR-0036
 * §Audit event taxonomy.
 *
 * Every state-changing path that writes to `audit_log` MUST import its
 * action string from here — a lint rule (paralleling ADR-0006's
 * `audit-policy`) flags raw string literals matching the dotted-verb
 * pattern against this file. The drift-guard test at
 * `tests/audit/payments-action-taxonomy.test.ts` enforces both
 * directions: every ADR taxonomy-table row exists as a named export
 * here, and no payments-verb literal leaks into `app/`, `lib/payments/`,
 * or `lib/audit/` outside this file.
 *
 * Total: 22 constants. The ADR-0036 §Audit event taxonomy table is 21
 * rows (Slice 1 + Slice 2 payment verbs); the +1 is
 * `ADMIN_REFUND_FLOW_OPENED`, which promotes the legacy ADR-0035-era
 * literal at `app/(admin)/admin/members/[id]/_actions/openRefundFlow.ts`
 * into the same registry. The asymmetry is documented in AC23 prose
 * and the taxonomy-test JSDoc; a retrospective ADR amendment is the
 * documented follow-up.
 *
 * Slice 1 ships the constants + the writer for `ADMIN_REFUND_DENIED`
 * (via `app/(admin)/admin/payments/refunds/new/_actions/initiateRefund.ts`)
 * + the writer for `ADMIN_REFUND_FLOW_OPENED` (already shipped via
 * `openRefundFlow.ts`). Writers for the remaining 20 verbs ship in
 * Slice 2 of ADR-0036.
 */

// ---- Refund flow (Slice 1 writes ADMIN_REFUND_DENIED + ADMIN_REFUND_FLOW_OPENED;
//                  Slice 2 writes the remaining four refund verbs) -----------

export const ADMIN_REFUND_INITIATED = 'admin.refund.initiated' as const;
export const ADMIN_REFUND_COMPLETED = 'admin.refund.completed' as const;
export const ADMIN_REFUND_FAILED = 'admin.refund.failed' as const;

/**
 * Fail-loud "over-authority" / "Stripe not configured" denial verb.
 *
 * Load-bearing convention (premortem D2): the fail-loud
 * `StripeNotConfiguredError` denial path in
 * `app/(admin)/admin/payments/refunds/new/_actions/initiateRefund.ts`
 * writes its `audit_log.target_id` as the literal sentinel
 * `'__stripe_not_configured__'` because:
 *
 *   1. `audit_log.target_id` is `text NOT NULL` per ADR-0006 — we
 *      cannot write NULL.
 *   2. Slice 1 has no `refund_requests` row to point at (the env probe
 *      fires BEFORE any DB insert succeeds — the refund_requests row
 *      is never created).
 *   3. The naive sentinel `'pending'` was REJECTED in the premortem
 *      because it collides with the `refund_requests.status='pending'`
 *      enum value — forensic queries that try to distinguish denied
 *      attempts from in-flight pending refunds would silently
 *      conflate them.
 *
 * Future contributors changing the sentinel MUST update:
 *   - This JSDoc.
 *   - `app/(admin)/admin/payments/refunds/new/_actions/initiateRefund.ts`
 *     (the writer).
 *   - `tests/payments/server-actions-stubs.test.ts` (assertion that
 *     the literal sentinel appears in the audit row's `target_id`).
 *
 * See `.conductor/36/premortem-synthesis.md` §D2 for the full
 * forensic-posture rationale.
 */
export const ADMIN_REFUND_DENIED = 'admin.refund.denied' as const;

export const ADMIN_REFUND_SETTLED = 'admin.refund.settled' as const;
export const ADMIN_REFUND_FLOW_OPENED = 'admin.refund.flow_opened' as const;

// ---- Membership state overrides (writers in Slice 2) ----------------------

export const ADMIN_MEMBERSHIP_STATUS_OVERRIDDEN = 'admin.membership.status_overridden' as const;
export const ADMIN_MEMBERSHIP_CANCELED = 'admin.membership.canceled' as const;
export const ADMIN_MEMBERSHIP_REACTIVATED = 'admin.membership.reactivated' as const;
export const ADMIN_MEMBERSHIP_GRACE_EXTENDED = 'admin.membership.grace_extended' as const;

// ---- Time-bank manual adjustments (writers in Slice 2) --------------------

export const ADMIN_TIME_BANK_MANUAL_CREDIT = 'admin.time_bank.manual_credit' as const;
export const ADMIN_TIME_BANK_MANUAL_DEBIT = 'admin.time_bank.manual_debit' as const;

// ---- Kill-switch toggling (writer in Slice 2) -----------------------------

export const ADMIN_KILL_SWITCH_TOGGLED = 'admin.kill_switch.toggled' as const;

// ---- Stripe webhook handler lifecycle (writers in Slice 2) ----------------

export const WEBHOOK_STRIPE_RECEIVED = 'webhook.stripe.received' as const;
export const WEBHOOK_STRIPE_PROCESSED = 'webhook.stripe.processed' as const;
export const WEBHOOK_STRIPE_FAILED = 'webhook.stripe.failed' as const;
export const WEBHOOK_STRIPE_SKIPPED_KILL_SWITCH = 'webhook.stripe.skipped_kill_switch' as const;

// ---- Webhook-driven side effects (writers in Slice 2) ---------------------

export const PAYMENT_SUCCEEDED = 'payment.succeeded' as const;
export const PAYMENT_FAILED = 'payment.failed' as const;
export const MEMBERSHIP_PAST_DUE = 'membership.past_due' as const;
export const DISPUTE_OPENED = 'dispute.opened' as const;
export const DISPUTE_CLOSED = 'dispute.closed' as const;

// ---- Discriminated union --------------------------------------------------

/**
 * Discriminated union of every canonical payments-related audit action
 * string. New action verbs MUST be added here AND to this union AND to
 * ADR-0006 §audit taxonomy AND to the matching ADR (ADR-0036 §Audit
 * event taxonomy for payment-related verbs).
 *
 * The drift-guard test at `tests/audit/payments-action-taxonomy.test.ts`
 * asserts this union stays exhaustive against the ADR table.
 */
export type PaymentsAuditAction =
  | typeof ADMIN_REFUND_INITIATED
  | typeof ADMIN_REFUND_COMPLETED
  | typeof ADMIN_REFUND_FAILED
  | typeof ADMIN_REFUND_DENIED
  | typeof ADMIN_REFUND_SETTLED
  | typeof ADMIN_REFUND_FLOW_OPENED
  | typeof ADMIN_MEMBERSHIP_STATUS_OVERRIDDEN
  | typeof ADMIN_MEMBERSHIP_CANCELED
  | typeof ADMIN_MEMBERSHIP_REACTIVATED
  | typeof ADMIN_MEMBERSHIP_GRACE_EXTENDED
  | typeof ADMIN_TIME_BANK_MANUAL_CREDIT
  | typeof ADMIN_TIME_BANK_MANUAL_DEBIT
  | typeof ADMIN_KILL_SWITCH_TOGGLED
  | typeof WEBHOOK_STRIPE_RECEIVED
  | typeof WEBHOOK_STRIPE_PROCESSED
  | typeof WEBHOOK_STRIPE_FAILED
  | typeof WEBHOOK_STRIPE_SKIPPED_KILL_SWITCH
  | typeof PAYMENT_SUCCEEDED
  | typeof PAYMENT_FAILED
  | typeof MEMBERSHIP_PAST_DUE
  | typeof DISPUTE_OPENED
  | typeof DISPUTE_CLOSED;
