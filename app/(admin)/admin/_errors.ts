import 'server-only';

/**
 * Admin-surface error classes (ADR-0035 AC15 / AC16 / AC18).
 *
 * These error types are thrown from `/admin/**` server actions to signal
 * specific business-rule violations that must NOT be confused with each
 * other in forensic logs OR in error-boundary toasts.
 *
 * Why a dedicated module (rather than extending `lib/auth/errors.ts`):
 *   - The two errors below are NOT auth-layer errors — they encode admin-
 *     ladder invariants (self-edit guard + multi-rung-demotion forbidden
 *     in v1 UI) that are scoped to the `/admin/**` route group. Keeping
 *     them adjacent to the actions that throw them makes the failure
 *     contract local + reviewable.
 *   - `InsufficientRoleError` (the auth-layer error) keeps its current
 *     shape and home in `lib/auth/errors.ts`. Role-ladder *authority*
 *     refines (e.g. promotion requires `owner`) reuse it directly.
 *
 * Premortem R12 (`withAudit` swallows non-error throws): both classes
 * MUST extend `Error` so that any `throw new <X>(...)` statement carries
 * a proper stack and is matched by the cross-cutting
 * `tests/admin/withAudit-throw-discipline.test.ts` walker (Slice 5 task
 * — not landed yet; the discipline is already enforced by the test
 * suites of t13 + t14 + t16).
 *
 * The `import 'server-only';` directive on line 1 is LOAD-BEARING — the
 * messages encode operational specifics (role names, profile ids) that
 * MUST NOT leak into client bundles. If a future refactor accidentally
 * pulls this file into a client component (e.g. via a shared types
 * module re-export), the directive trips Next's compiler and fails the
 * build rather than silently shipping the role-ladder semantics to the
 * browser.
 */

/**
 * Thrown when an admin attempts to perform a destructive admin action
 * (role change, reverification request, deletion initiation, refund
 * flow, verification approve/reject) against their OWN profile.
 *
 * ADR-0035 §Self-edit prevention: the v1 application invariant is "no
 * admin acts on their own profile" — otherwise the last owner could
 * demote themselves and lock the org out. UI-level the four destructive
 * buttons are hidden; this server-side error is the defense-in-depth
 * gate (see AC15-17, AC34).
 *
 * Forensic note: this error fires BEFORE the audit-tx opens, so no
 * audit row is written on a self-edit attempt. That is deliberate — the
 * `tests/admin/no-pii-in-admin-audit.test.ts` invariant gets stronger
 * if "denied self-edit" never lands in `audit_log` at all (no PII to
 * leak, no forensic noise). Slice 5 may add a separate
 * `admin.session.self_edit_denied` event for ops visibility; v1 ships
 * the cleaner posture.
 */
export class SelfEditViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfEditViolation';
  }
}

/**
 * Thrown by `changeRole` when the requested role-ladder transition is
 * forbidden in the v1 UI — specifically a multi-rung demotion
 * (e.g. `owner → member`, skipping `manager` + `cashier`).
 *
 * ADR-0035 §Role-ladder authority refine: one-rung demotions are
 * covered by the outer `requireRole('manager')` gate; promotions
 * require an additional `requireRole('owner')` (and surface as
 * `InsufficientRoleError`); multi-rung demotions throw this error so a
 * compromised manager session can't fast-path a hostile takedown.
 *
 * Forensic note: like `SelfEditViolation`, this error fires BEFORE the
 * audit-tx opens — no audit row is written for the rejected attempt.
 * Same reasoning: cleaner audit posture, the role-ladder defense test
 * (AC29) verifies the outer gates still hold.
 */
export class RoleLadderViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleLadderViolation';
  }
}

/**
 * Thrown by `rejectVerification` when the staff-authored reject `reason`
 * is empty (length 0) or longer than 500 characters.
 *
 * ADR-0035 AC13: `reason` length 1..500 is the contract — values outside
 * the range surface as `RejectReasonInvalid` so the page-level error
 * boundary can render a "please write a reason between 1 and 500
 * characters" toast that is distinct from generic auth / DB failures.
 *
 * Forensic note: like the other admin-domain errors, this fires BEFORE
 * the audit-tx opens — no audit row is written for an invalid reason.
 * The staff member sees the toast, fixes their input, and resubmits;
 * the audit log records only the eventual valid attempt (cleaner
 * forensic posture; no half-attempts to interpret).
 *
 * Extends `Error` per premortem R12 (`withAudit` swallows non-error
 * throws) — see file header.
 */
export class RejectReasonInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RejectReasonInvalid';
  }
}

/**
 * Thrown by `requestVerificationInfo` when the staff-authored
 * `message` is empty (length 0) or longer than 1000 characters.
 *
 * ADR-0035 AC14: `message` length 1..1000 is the contract — values
 * outside the range surface as `MessageInvalid` so the page-level
 * error boundary can render a distinct toast (separate from
 * `RejectReasonInvalid` since the bounds differ: 500 vs 1000 chars,
 * and the toast copy / next-action UX differ).
 *
 * Forensic note: like the other admin-domain errors, this fires
 * BEFORE the audit-tx opens — no audit row is written for an invalid
 * message length. The verbatim message itself is NEVER stored in the
 * audit row regardless of validity (only the length is captured —
 * AC28 no-PII contract); the validation throw simply short-circuits
 * the audit-tx entirely on a bad-input attempt.
 *
 * Extends `Error` per premortem R12 (`withAudit` swallows non-error
 * throws) — see file header.
 */
export class MessageInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageInvalid';
  }
}

/**
 * Thrown by `updateFlag` when the caller did not supply any of the four
 * mutable fields (`enabled`, `percent`, `allowlist`, `roleGate`) — i.e.
 * the call would write an audit row with empty `before`/`after` deltas
 * and would have NO state-change effect.
 *
 * ADR-0035 AC22: at least one of the four optional fields MUST be present
 * for the action to proceed. The empty-input case surfaces as `NoChange`
 * so the page-level error boundary can render a "nothing to save" toast
 * distinct from generic auth / DB failures, AND the audit log never
 * captures a no-op write (cleaner forensic posture — premortem R12).
 *
 * Forensic note: like the other admin-domain errors, this fires BEFORE
 * the audit-tx opens — no audit row is written for a no-fields call.
 * The cross-cutting `tests/admin/no-pii-in-admin-audit.test.ts` invariant
 * gets stronger if "no-op writes" never land in `audit_log` at all (no
 * forensic noise; the audit log carries operational truth).
 *
 * Extends `Error` per premortem R12 (`withAudit` swallows non-error
 * throws) — see file header.
 */
export class NoChange extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoChange';
  }
}

/**
 * Thrown by admin actions when caller-supplied input is malformed or
 * references a row that does not exist — BEFORE any state mutation OR
 * audit-row emission. The shape mirrors HTTP 400 — "the request itself
 * was malformed; we did not even try to act on it."
 *
 * Concrete uses (ADR-0035 / premortem R9):
 *   - `openRefundFlow` (AC17): rejects `profileId` that is not a
 *     well-formed UUID OR does not correspond to an existing profile
 *     row. AC18 specifies NO typed-confirmation UI for the refund-flow
 *     button (it's a redirect, not a mutation), so the action itself
 *     is the only defense against a compromised manager session POSTing
 *     thousands of `admin.refund.flow_opened` audit breadcrumbs against
 *     random profile ids for forensic noise. The validation MUST run
 *     BEFORE `withAudit` opens its tx.
 *
 * Forensic note: like `SelfEditViolation` + `RoleLadderViolation`, this
 * error fires BEFORE any audit-tx opens — NO audit row is written for a
 * rejected attempt. The premortem R9 mitigation specifically prescribes
 * "no audit row" as part of the BadRequest semantics: the audit log
 * carries operational truth, and a malformed-input rejection has no
 * operational meaning to record.
 *
 * Extends `Error` per premortem R12 (`withAudit` swallows non-error
 * throws) — see file header.
 */
export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequest';
  }
}

/**
 * Thrown by the privacy-queue actions (`approveExport`, `approveDeletion`,
 * `rejectRequest`) when the targeted `privacy_requests` row is not in the
 * `status='pending'` state required for the transition.
 *
 * ADR-0035 AC24-AC26: each privacy-queue action is a one-shot state
 * transition gated by the row's current `status` value. A re-approve on
 * a `'completed'` request, a re-reject on a `'rejected'` request, or any
 * concurrent transition that loses the SELECT-FOR-UPDATE race surfaces
 * here so the UI can render a distinct "this request is no longer
 * pending — refresh the queue" toast (separate from generic auth or DB
 * failures).
 *
 * Forensic note: the throw fires INSIDE the audit-tx (after the SELECT
 * FOR UPDATE that captures the current state) — `withAudit` propagates
 * the error and the caller's transaction wrapper rolls back, so NO
 * audit row is written for a rejected attempt. Same posture as the
 * idempotent no-op branch of `approveVerification`: the audit log
 * records operational truth, and "tried to act on a non-pending row"
 * carries no operational meaning that survives the race.
 *
 * Extends `Error` per premortem R12 (`withAudit` swallows non-error
 * throws) — see file header.
 */
export class RequestNotPending extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestNotPending';
  }
}

/**
 * Thrown by `approveDeletion` when the caller-supplied `confirmEmail`
 * does not match the `requester_email` captured on the
 * `privacy_requests` row at submission time.
 *
 * ADR-0035 AC25 + premortem R10 (LOAD-BEARING): the typed-confirmation
 * dialog requires the staff member to type the requester's email exactly;
 * the server-side guard re-validates the typed phrase against the
 * captured value INSIDE the audit-tx (after the SELECT FOR UPDATE
 * confirms the row + status='pending'). A mismatch here is the last
 * defense against the "wrong member deleted" premortem — a compromised
 * manager session that POSTs directly to the action bypasses the
 * client-side typed gate, so the server-side `confirmEmail ===
 * requester_email` assertion is the load-bearing check.
 *
 * Forensic note: like `RequestNotPending`, the throw fires INSIDE the
 * audit-tx, after the SELECT FOR UPDATE captures the row but BEFORE
 * `softDeleteProfile` runs. `withAudit` propagates the error and the
 * caller's transaction wrapper rolls back, so NO audit row is written
 * for a mismatched-confirm attempt AND `softDeleteProfile` is NOT
 * called. The tests in `tests/admin/approve-deletion-action.test.ts`
 * pin both invariants — wrong confirm → no audit row AND
 * `softDeleteProfile` not called.
 *
 * Extends `Error` per premortem R12 (`withAudit` swallows non-error
 * throws) — see file header.
 */
export class ConfirmEmailMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfirmEmailMismatch';
  }
}
