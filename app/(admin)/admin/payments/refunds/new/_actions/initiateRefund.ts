import 'server-only';

/**
 * `initiateRefund` — Slice 1 fail-loud server action for the new-refund
 * form at `/admin/payments/refunds/new` (ADR-0036 §Refund approval
 * workflow + spec AC21).
 *
 * **Slice 1 contract (this file):** the Stripe boundary is not yet
 * wired. Every call from a manager+ with valid params writes an
 * `admin.refund.denied` audit breadcrumb (so forensics can answer
 * "did anyone TRY to refund before Stripe activation?") and THEN
 * throws `StripeNotConfiguredError` which the segment-level
 * `error.tsx` (t11) renders via `error.userMessage`.
 *
 * Slice 2 will invert steps 6/7 — env probe moves BEFORE the audit
 * because the audit row will be `admin.refund.initiated` (not
 * `admin.refund.denied`), the authority guard runs second, the DB
 * INSERT into `refund_requests` runs third, the Stripe API call runs
 * fourth.
 *
 * Strict body ordering (load-bearing — premortem risk 1; DO NOT
 * REORDER):
 *
 *   1. `await requireRole('manager')` — InsufficientRoleError thrown
 *      here propagates BEFORE any audit row writes. Forensic
 *      breadcrumb for `admin.session.role_check_denied` is emitted
 *      by `requireRole.ts` itself via `__auditHooks` (not by this
 *      action).
 *   2. Zod schema validation — `BadRequest` thrown here propagates
 *      BEFORE any audit row writes. `.int().positive().finite()` on
 *      `amountCents` is load-bearing (premortem R7 — `.finite()`
 *      rejects NaN + Infinity which `.int()` does not).
 *   3. `assertRefundAuthority({...})` — InsufficientAuthorityError
 *      thrown here propagates WITHOUT writing an audit row. This is
 *      INTENTIONAL ASYMMETRY (premortem R6, Open Q2 resolution):
 *      over-authority is "user error at the gate"; not-configured is
 *      "system error after the gate." A future `admin.refund.
 *      authority_denied` constant may collapse the asymmetry in
 *      Slice 2 — DO NOT add `withAudit` here in the interim.
 *   4. **Inside `runner.transaction(...)` wrapper** (premortem R11):
 *      `withAudit({ action: ADMIN_REFUND_DENIED, ... })` commits the
 *      breadcrumb. The transaction wrapper mirrors `openRefundFlow.ts`
 *      so Slice 2's DB INSERT into `refund_requests` lands inside the
 *      same tx without a refactor.
 *   5. **AFTER** `withAudit` returns: `assertStripeConfigured()` —
 *      throws `StripeNotConfiguredError`. The throw propagates to
 *      the segment-level error boundary at
 *      `app/(admin)/admin/payments/refunds/new/error.tsx` (t11)
 *      which renders `error.userMessage` (NEVER `error.message` —
 *      see `_errors.ts` JSDoc for the redaction posture).
 *
 * Audit row payload (D2 sentinel — premortem-binding):
 *   - `action`:     `ADMIN_REFUND_DENIED` (= `'admin.refund.denied'`)
 *   - `targetType`: `'refund_request'`
 *   - `targetId`:   `'__stripe_not_configured__'` (NOT `'pending'`
 *     per premortem D2 — `'pending'` collides with
 *     `refund_requests.status='pending'` enum value)
 *   - `actorId`:    `actor.id`
 *   - `before`:     `null` (no prior state — this is a denial
 *     breadcrumb, not a mutation)
 *   - `after`:      `{ reason: 'stripe_not_configured', refund_type,
 *     amount_cents }`
 *
 * The transaction-runner injection mirrors
 * `app/(admin)/admin/members/[id]/_actions/openRefundFlow.ts`:
 * production uses the shared Postgres runner and tests inject the
 * same structural seam.
 *
 * Forensic note — why an audit row at all on a not-configured throw:
 *   The Stripe activation runbook (ADR-0010) is the long-pole. While
 *   we wait, a manager clicking the refund button leaves a
 *   `admin.refund.denied` breadcrumb that an inquiring auditor can
 *   surface even though no real refund attempt happened. The
 *   `target_id = '__stripe_not_configured__'` sentinel is the
 *   forensic signal that the denial is system-state, not user-state.
 */

import { z } from 'zod';

import { requireRole } from '@/lib/auth/requireRole';
import { withAudit } from '@/lib/audit/withAudit';
import { postgresTransactionRunner } from '@/lib/db/postgres-transaction-runner';
import type { TransactionRunner } from '@/lib/db/transactions';
import { assertRefundAuthority, type RefundType } from '@/lib/payments/authority';
import { assertStripeConfigured } from '@/lib/payments/stripe-client';
import { ADMIN_REFUND_DENIED } from '@/lib/audit/actions';
import { cents } from '@/lib/money/types';
import { BadRequest } from '@/app/(admin)/admin/_errors';

// ---- Public types ---------------------------------------------------------

/**
 * Five refund-reason enum values per ADR-0036 §Refund approval
 * workflow + Stripe's `Refund.reason` field (excluding `'fraudulent'`
 * which Stripe restricts to specific card-network agreements; we
 * accept the literal for forensics, the actual Stripe call in Slice 2
 * may down-translate as needed). `'goodwill'` and `'other'` are
 * club-side categories that have no Stripe equivalent and remain in
 * the audit row for forensic reasoning.
 */
export type RefundReason =
  | 'duplicate'
  | 'fraudulent'
  | 'requested_by_customer'
  | 'goodwill'
  | 'other';

export interface InitiateRefundParams {
  /** `payments.id` as form-string (bigint serializes as text). */
  targetPaymentId: string;
  /** Refund amount in INTEGER CENTS (NOT dollars). */
  amountCents: number;
  reason: RefundReason;
  /** Optional free-text annotation. */
  reasonNote?: string;
  refundType: RefundType;
  /** Form-mount UUID v4 (ADR-0005 idempotency anchor). */
  idempotencyKey: string;
}

/**
 * Slice 1 NEVER returns success — every code path throws. Slice 2
 * will return `{ ok: true, refundRequestId: string }` once the DB
 * INSERT lands. We pin the future shape here so the form's
 * `useFormState` (or `<form action={...}>` pending state) can already
 * destructure against it without a Slice-2 type churn.
 */
export interface InitiateRefundResult {
  ok: true;
  refundRequestId: string;
}

/**
 * Shared transaction seam. Tests inject a runner; production uses the
 * Postgres runner.
 */
export type { TransactionRunner } from '@/lib/db/transactions';

// ---- Zod schema -----------------------------------------------------------

/**
 * Validation schema — runs BEFORE any audit-tx. Premortem R7 binds
 * `.int().positive().finite()` on `amountCents`:
 *   - `.int()` rejects fractional numbers (e.g. `2500.5` that could
 *     bypass the 2500c boundary check on `requiredRoleFor`).
 *   - `.positive()` rejects 0 + negatives.
 *   - `.finite()` is the LOAD-BEARING refinement — it rejects NaN and
 *     Infinity which `.int()` accepts (per Zod's number semantics)
 *     and which would otherwise become `null` in the audit `after`
 *     payload via `JSON.stringify(NaN) === 'null'`.
 *
 * `idempotencyKey` is UUID-shape (not strictly v4) — the form-mount
 * UUID is generated via `crypto.randomUUID()` which is v4, but
 * accepting any RFC 4122 shape via `.uuid()` avoids false-rejects on
 * legacy seeds + Slice 2 form-rewrite churn.
 */
const InitiateRefundParamsSchema = z.object({
  targetPaymentId: z.string().min(1),
  amountCents: z.number().int().positive().finite(),
  reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer', 'goodwill', 'other']),
  reasonNote: z.string().optional(),
  refundType: z.enum(['time_bank', 'membership_current', 'membership_previous']),
  idempotencyKey: z.string().uuid(),
});

// ---- The action -----------------------------------------------------------

/**
 * Emit an `admin.refund.denied` audit breadcrumb + throw
 * `StripeNotConfiguredError` (Slice 1).
 *
 * @param params - {@link InitiateRefundParams}
 * @param db - optional `TransactionRunner` for test injection
 *
 * @throws InsufficientRoleError - actor below `manager` rank
 * @throws BadRequest - Zod validation failure (no audit row)
 * @throws InsufficientAuthorityError - actor cannot issue this
 *   `(refundType, amountCents)` cell of the ADR-0027 matrix
 *   (NO audit row — intentional asymmetry per Open Q2)
 * @throws StripeNotConfiguredError - Slice 1 sentinel; the
 *   `admin.refund.denied` audit row HAS been written before this
 *   throw (load-bearing premortem R1 ordering)
 *
 * @returns Promise<never> in Slice 1 — every path throws. Signature
 *   pins `Promise<InitiateRefundResult>` for Slice 2 forward-compat.
 */
export async function initiateRefund(
  params: InitiateRefundParams,
  db?: TransactionRunner,
): Promise<InitiateRefundResult> {
  // (1) Coarse role gate — InsufficientRoleError propagates BEFORE
  //     any audit row writes. ADR-0035 AC5 first-await defense-in-
  //     depth pattern.
  const { profile: actor } = await requireRole('manager');

  // (2) Zod validation — BadRequest propagates BEFORE the audit-tx.
  //     Mirrors openRefundFlow.ts's AC17 input-validation contract:
  //     malformed input has no operational meaning, so the audit log
  //     refuses to record a rejected-shape attempt. Premortem R7's
  //     `.finite()` is load-bearing — see schema JSDoc.
  //
  //     Local `parsed` typed via `z.infer` (NOT `InitiateRefundParams`)
  //     because the project enables `exactOptionalPropertyTypes: true`,
  //     and Zod's `.optional()` yields `T | undefined` (explicit
  //     undefined) which is structurally distinct from
  //     `InitiateRefundParams.reasonNote?: string` (absent-or-T).
  //     The two types are operationally equivalent for downstream
  //     consumers but TypeScript's flag forbids the implicit widening.
  let parsed: z.infer<typeof InitiateRefundParamsSchema>;
  try {
    parsed = InitiateRefundParamsSchema.parse(params);
  } catch (err) {
    // Re-throw as BadRequest so the segment-level error boundary
    // can render a "please fix your input" toast distinct from
    // generic auth / DB failures. Mirror openRefundFlow.ts's
    // BadRequest semantics.
    throw new BadRequest(
      `initiateRefund: invalid params — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // (3) AUTHORITY-DENIAL DOES NOT WRITE AUDIT — by design per spec
  //     Open Q2 + premortem R6.
  //     Over-authority is "user error at the gate"; not-configured
  //     is "system error after the gate". If forensics need
  //     authority-denial rows, ship ADMIN_REFUND_AUTHORITY_DENIED in
  //     Slice 2 (new constant, NOT a reuse of ADMIN_REFUND_DENIED).
  //     DO NOT add `withAudit` here in the interim — the asymmetry
  //     is documented + intentional.
  await assertRefundAuthority({
    actorRole: actor.role,
    amountCents: cents(parsed.amountCents),
    refundType: parsed.refundType,
  });

  // (4) Audit-tx — `withAudit` writes the `admin.refund.denied`
  //     breadcrumb. Wrapped in `runner.transaction(...)` per
  //     premortem R11 so Slice 2's DB INSERT into `refund_requests`
  //     lands inside the same transaction without a refactor.
  //
  //     LOAD-BEARING ORDER per ADR-0036 + spec AC21 step 8: audit
  //     row commits FIRST (this block), env-probe throws SECOND
  //     (below). DO NOT REORDER. DO NOT INLINE
  //     `assertStripeConfigured()` INTO `withAudit`'s `mutate`
  //     callback — the throw would escape `mutate` BEFORE the
  //     audit INSERT runs (per `lib/audit/withAudit.ts` line 271:
  //     the audit INSERT runs AFTER `mutate` returns).
  const runner = db ?? postgresTransactionRunner;
  await runner.transaction(async (tx) =>
    withAudit(
      tx,
      {
        action: ADMIN_REFUND_DENIED,
        targetType: 'refund_request',
        // D2 sentinel — NOT 'pending' (which collides with
        // refund_requests.status='pending' enum value, breaking
        // forensic queries that try to distinguish denied attempts
        // from in-flight pending refunds). See
        // `.conductor/36/premortem-synthesis.md` §D2 for the full
        // forensic-posture rationale.
        targetId: '__stripe_not_configured__',
        actorId: actor.id,
      },
      // No SQL UPDATE — this is a breadcrumb, not a mutation. The
      // `mutate` callback simply returns the before/after/result
      // tuple. `before = null` per AC21.6's "no prior state"
      // contract; `after` carries the denial reason + structural
      // refund metadata for forensic queries.
      //
      // Plain function, not async — the callback returns a Promise
      // already; an `async` modifier without an `await` inside is a
      // lint error per @typescript-eslint/require-await.
      (_tx) =>
        Promise.resolve({
          before: null,
          after: {
            reason: 'stripe_not_configured' as const,
            refund_type: parsed.refundType,
            amount_cents: parsed.amountCents,
          },
          result: { ok: true as const },
        }),
    ),
  );

  // (5) AFTER `withAudit` commits — fail-loud at the Stripe boundary.
  //     The throw propagates to the segment-level error boundary at
  //     `app/(admin)/admin/payments/refunds/new/error.tsx` (t11)
  //     which renders `error.userMessage`. Slice 2 of ADR-0010
  //     replaces this with a real `getStripeClient().refunds.create(...)`
  //     call.
  assertStripeConfigured();

  // Unreachable in Slice 1 — `assertStripeConfigured()` above always
  // throws when STRIPE_SECRET_KEY is unset (which it is in Slice 1).
  // The return statement satisfies TypeScript's control-flow
  // analysis for the `Promise<InitiateRefundResult>` signature and
  // pins the Slice 2 success shape.
  /* istanbul ignore next — unreachable in Slice 1 */
  throw new Error('initiateRefund: unreachable — assertStripeConfigured did not throw in Slice 1');
}
