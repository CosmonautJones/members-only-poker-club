import 'server-only';
import type { Cents } from '@/lib/money/types';
import type { Role } from '@/lib/auth/types';
import { roleAtLeast } from '@/lib/auth/roleAtLeast';

/**
 * Authority-matrix runtime guard for refund operations (ADR-0027 +
 * ADR-0036 §Authority enforcement).
 *
 * This module is a pure runtime guard. It NEVER reads the DB, NEVER
 * calls Stripe, NEVER writes audit. Every refund-initiating server
 * action (slice-2 onward) MUST call `assertRefundAuthority` AFTER
 * `requireRole('manager')` and BEFORE the Stripe / DB write.
 *
 * **The COARSE-vs-FINE gate contract (premortem R8 — load-bearing).**
 * `requireRole` is the COARSE gate ("is this person at least a
 * manager?"); `assertRefundAuthority` is the FINE gate ("can THIS
 * specific manager issue THIS specific refund amount?"). Skipping
 * the fine gate on the assumption that the coarse gate is sufficient
 * is the canonical authority-matrix-bypass bug — see ADR-0036's
 * future manual-credit / membership-override surfaces in slices
 * 2–5.
 *
 * **Unit convention (premortem R9 — load-bearing).** `amountCents`
 * is INTEGER CENTS, not dollars. `500` means $5.00, NOT $500.00.
 * The branded `Cents` type from `@/lib/money/types` is a
 * compile-time hint only; callers passing raw `number` MUST
 * construct via `cents(...)` after converting from dollars. The
 * `requiredRoleFor` runtime guard rejects non-integer / negative /
 * non-finite inputs, but it CANNOT detect dollar-vs-cent confusion
 * (e.g., integer 50000 could mean $500.00-in-cents or
 * $50,000.00-in-dollars). Pin the unit unambiguously at every
 * call site.
 *
 * **Server-only (premortem R10).** This module carries
 * `import 'server-only';` so the matrix logic, the ROLE_RANK ladder
 * (via roleAtLeast), and the `InsufficientAuthorityError` shape do
 * NOT ship to client bundles. A motivated attacker who can read
 * the matrix in their bundle can craft requests that hit specific
 * cells — defense-in-depth that the gate logic stays server-side.
 */

/**
 * The three refund variants supported by ADR-0036 Slice 1.
 *
 * Future variants (e.g. `'refund_credit'`) require BOTH:
 *   (a) adding the literal here AND the matching branch in
 *       `requiredRoleFor`;
 *   (b) extending `AUTHORITY_TABLE` in
 *       `tests/payments/authority.test.ts` with cells covering every
 *       (role × amountCents-bucket) tuple for the new variant.
 *
 * The meta-assertion in that test file (premortem R7) catches
 * (b)-without-(a) at runtime; the `never` exhaustiveness check in
 * `requiredRoleFor` catches (a)-without-(b) at compile time.
 */
export type RefundType = 'time_bank' | 'membership_current' | 'membership_previous';

/**
 * Thrown by `assertRefundAuthority` when the actor's role is below
 * the role required for a given (refundType, amountCents) cell of
 * the ADR-0027 authority matrix.
 *
 * **Redaction posture (premortem R6).** `toJSON()` is overridden to
 * emit `{ name, message, required, refundType }` only — `actorRole`
 * and `amountCents` are omitted because role + money pairing is
 * operationally sensitive (a "this manager attempted a $500 refund"
 * breadcrumb in Sentry surfaced to non-admin Sentry seats is a
 * posture regression even though neither field is formally PII per
 * ADR-0035 AC28). Server-side audit-row writers that need the full
 * payload access fields directly (`err.actorRole`, `err.amountCents`)
 * — field access bypasses `toJSON`, so the audit log retains full
 * forensic fidelity. Boundary code that serializes the error for
 * client transport (Sentry's default, Next.js error digest, etc.)
 * sees only the redacted shape.
 */
export class InsufficientAuthorityError extends Error {
  public override readonly name = 'InsufficientAuthorityError';
  constructor(
    public readonly actorRole: Role,
    public readonly required: Role,
    public readonly refundType: RefundType,
    public readonly amountCents: Cents,
  ) {
    super(
      `Role '${actorRole}' cannot issue a ${refundType} refund of ` +
        `${amountCents}c; requires '${required}'.`,
    );
  }

  /**
   * Sentry / boundary serialization redaction. Emits the redacted
   * shape `{ name, message, required, refundType }` — explicitly
   * omits the `actorRole` and `amountCents` FIELDS. The emitted
   * `message` is a sanitized version that names the required role
   * and refundType (operationally useful for triage) but redacts
   * the actor's role and the amount in cents (which the live
   * `err.message` field carries verbatim for server-side audit
   * fidelity).
   *
   * Server-side audit-row writers that need the un-redacted payload
   * read `err.actorRole`, `err.amountCents`, AND `err.message`
   * directly — field access bypasses `toJSON`, so audit_log retains
   * full forensic detail. Only the JSON-serialized projection
   * (Sentry's default path; Next.js error digest; any
   * `JSON.stringify(err)` invocation) sees the redacted shape.
   */
  toJSON(): { name: string; message: string; required: Role; refundType: RefundType } {
    return {
      name: this.name,
      // Redacted forensic blurb — names the required role + refundType
      // but NOT the actor's role or the amount in cents.
      message: `Authority denied: ${this.refundType} refund requires '${this.required}'.`,
      required: this.required,
      refundType: this.refundType,
    };
  }
}

/**
 * Compute the minimum role required to issue a refund of the given
 * type and amount, per ADR-0027 §Authority matrix.
 *
 * **The matrix (verbatim from ADR-0036 §Authority enforcement):**
 *   - `time_bank` ≤ 2500c ($25.00) → `cashier`
 *   - `time_bank` ≤ 20000c ($200.00) → `manager`
 *   - `time_bank` > 20000c → `owner`
 *   - `membership_current` → `manager` (regardless of amount)
 *   - `membership_previous` → `owner` (regardless of amount)
 *
 * **Runtime guard (premortem R2).** Although the `Cents` branded
 * type is structural-only, a future caller passing a raw number
 * (sign-flipped subtraction, malformed parseInt, dollar-from-Stripe)
 * bypasses TS. The first runtime statement validates that
 * `amountCents` is a non-negative integer and rejects anything else
 * with `RangeError` BEFORE the matrix logic runs — defense-in-depth
 * beyond the DB-layer `refund_requests_amount_positive` CHECK
 * constraint.
 *
 * **Exhaustiveness (premortem R4).** The trailing `never` branch
 * THROWS `TypeError` rather than returning the runtime value of
 * `refundType` cast as `Role`. A `roleAtLeast(actorRole,
 * <garbage>)` call would otherwise yield `false` via JS coercion
 * on `undefined`, which silently grants authority. Throwing is
 * the only safe behavior for an unknown variant.
 *
 * @param refundType - the refund variant; must be a member of `RefundType`
 * @param amountCents - the refund amount in INTEGER CENTS (NOT dollars)
 * @returns the minimum role required to issue this refund
 * @throws RangeError if `amountCents` is not a non-negative integer
 * @throws TypeError if `refundType` is not a member of the `RefundType` union
 */
export function requiredRoleFor(refundType: RefundType, amountCents: Cents): Role {
  // R2 — runtime guard. `Cents` is a TS phantom; the brand erases at
  // runtime. Reject negative / NaN / Infinity / fractional inputs with
  // a clear, fast-failing error.
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new RangeError(
      'amountCents must be a non-negative integer; received: ' + JSON.stringify(amountCents),
    );
  }

  if (refundType === 'time_bank') {
    if (amountCents <= 2500) return 'cashier';
    if (amountCents <= 20000) return 'manager';
    return 'owner';
  }
  if (refundType === 'membership_current') {
    return 'manager';
  }
  if (refundType === 'membership_previous') {
    return 'owner';
  }

  // R4 — exhaustiveness. The `never` assignment is a compile-time
  // check; the throw is the runtime safety net for callers that
  // bypass the type system via `as RefundType`.
  const _exhaustive: never = refundType;
  throw new TypeError('requiredRoleFor: unknown refundType: ' + JSON.stringify(_exhaustive));
}

/**
 * Assert that `actorRole` is authorized to issue a refund of
 * (`refundType`, `amountCents`). Throws `InsufficientAuthorityError`
 * with the full denial payload (actorRole, required, refundType,
 * amountCents) if the actor's rank is below the required rank.
 *
 * **monthsBack is accepted-but-ignored in v1 (premortem R3).** The
 * ADR-0027 matrix does not distinguish "previous month" by recency
 * in v1 — every `membership_previous` is owner-only regardless of
 * how far back. The parameter is preserved in the signature so
 * future callers (e.g. a "graceful 3-month manager override for
 * previous-month refunds" feature) have a no-op slot to wire into;
 * adding behavior to it REQUIRES (a) an ADR-0027 amendment naming
 * the new cell AND (b) adding the new (refundType × monthsBack ×
 * amountCents-bucket) cells to `AUTHORITY_TABLE` in
 * `tests/payments/authority.test.ts`. The sentinel test in that
 * file pins `monthsBack: 0 / 12 / undefined → identical results`
 * so a silent v2 enhancement fails loudly.
 *
 * Returns `Promise<void>` for caller-symmetry with other
 * server-action assertion helpers (e.g. `requireRole`); the body
 * is synchronous.
 *
 * @param opts.actorRole - the actor's role (typically `actor.role` from `requireRole`)
 * @param opts.amountCents - the refund amount in INTEGER CENTS
 * @param opts.refundType - the refund variant
 * @param opts.monthsBack - accepted but ignored in v1; see JSDoc above
 */
// eslint-disable-next-line @typescript-eslint/require-await -- async signature pinned by ADR contract; body is synchronous in v1.
export async function assertRefundAuthority(opts: {
  actorRole: Role;
  amountCents: Cents;
  refundType: RefundType;
  monthsBack?: number;
}): Promise<void> {
  const { actorRole, amountCents, refundType } = opts;
  // `monthsBack` is intentionally unused in v1 (see JSDoc R3).
  const required = requiredRoleFor(refundType, amountCents);
  if (!roleAtLeast(actorRole, required)) {
    throw new InsufficientAuthorityError(actorRole, required, refundType, amountCents);
  }
}
