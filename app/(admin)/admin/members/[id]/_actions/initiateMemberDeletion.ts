import 'server-only';

/**
 * `initiateMemberDeletion` — server action that opens a manager-initiated
 * deletion request for a member by INSERTing a row into `privacy_requests`
 * (ADR-0035 AC34, WD.T24).
 *
 * Contract (load-bearing — do not weaken):
 *
 *   1. **First runtime statement is `await requireRole('manager');`** —
 *      the outer auth gate. AC5 first-await defense-in-depth.
 *
 *   2. **Self-edit guard** throws `SelfEditViolation` BEFORE any audit
 *      row is written. A manager cannot open a deletion request against
 *      their own profile — the v1 invariant for all destructive admin
 *      actions per ADR-0035 §Self-edit prevention. Self-edit fires
 *      BEFORE `withAudit` opens its tx so no audit row exists for the
 *      rejected attempt.
 *
 *   3. **Reason length validation** — `reason` length MUST be in `[1, 500]`.
 *      Surfaces as `RejectReasonInvalid` (reused from `_errors.ts`; same
 *      bounds as `rejectVerification`'s reason — kept identical so the
 *      page-level error boundary toast copy is reusable). Fires BEFORE
 *      the audit tx; no audit row is written for a rejected attempt.
 *      The reason itself is NOT stored in the audit row (no PII /
 *      free-text in audit per AC28); the reason is stored in
 *      `privacy_requests.reject_reason`? — NO. Per AC34 the reason is
 *      operational metadata visible to the manager surface (e.g.
 *      pre-fill the email confirmation), NOT persisted on the request
 *      row in this slice. Storage of the reason on the request row is
 *      deferred to a future cycle when /admin/privacy renders the
 *      reason in the queue view.
 *
 *   4. **Pre-anonymization check** — inside the audit tx, after the
 *      SELECT FOR UPDATE, assert `email NOT LIKE 'del:%'`. The
 *      `del:<sha256>` prefix is the soft-delete sentinel set by
 *      `softDeleteProfile` (ADR-0023). Initiating deletion of an
 *      already-anonymized profile is a no-op at best and a forensic
 *      anomaly at worst — fail loudly with `BadRequest` so the
 *      page-level error boundary renders "this profile is already
 *      anonymized" rather than silently inserting a duplicate
 *      `privacy_requests` row.
 *
 *   5. **Single-tx invariant** (the load-bearing AC34 contract):
 *      Inside `withAudit('admin.member.deletion_initiated', 'profile', profileId)`:
 *        - SELECT id, email FROM profiles WHERE id = $1 FOR UPDATE —
 *          assert exists + not already anonymized.
 *        - INSERT INTO privacy_requests (profile_id, requester_email,
 *          kind, status, submitted_at, resolved_by) VALUES (...) —
 *          `requester_email` is the captured profile.email (NOT the
 *          actor's email). `resolved_by` is left NULL; the resolving
 *          manager is recorded by `approveDeletion` in AC25 — this
 *          action only opens the request.
 *        - Capture the new `privacy_requests.id` for the audit row's
 *          `after = { request_id }`.
 *      The audit row INSERT happens INSIDE the same `withAudit` tx, so
 *      either both writes commit or both roll back (premortem R1 —
 *      "no mutation commits without its audit row").
 *
 *   6. **No PII in audit row** — `before = null` (this is an INSERT,
 *      no prior state); `after = { request_id: '<uuid>' }`. The
 *      `requester_email` lives in `privacy_requests`, not in the
 *      audit row. AC28 no-PII contract enforced by
 *      `tests/admin/no-pii-in-admin-audit.test.ts` (Slice 5 walker)
 *      and by the test in this slice.
 *
 *   7. **Post-tx `revalidateTag('admin-dashboard-counts')`** (AC35) —
 *      this action increments the pending-deletions count on the
 *      dashboard. Wrapped in try/catch so a Next-cache outage cannot
 *      roll back the audit-tx commit (premortem R2).
 *
 * Production defaults to the shared Postgres transaction runner. Tests
 * inject the same `TransactionRunner` seam with PGlite.
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import { withAudit } from '@/lib/audit/withAudit';
import { postgresTransactionRunner } from '@/lib/db/postgres-transaction-runner';
import type { TransactionRunner } from '@/lib/db/transactions';
import { trackAdminEvent } from '@/lib/analytics/admin-events';

import { SelfEditViolation, RejectReasonInvalid, BadRequest } from '@/app/(admin)/admin/_errors';

// ---- Public types ---------------------------------------------------------

export interface InitiateMemberDeletionParams {
  profileId: string;
  /** 1..500 chars; staff-authored justification. NOT persisted in audit row. */
  reason: string;
}

export interface InitiateMemberDeletionResult {
  ok: true;
  /** The newly-created `privacy_requests.id` (uuid). */
  requestId: string;
}

/**
 * Shared transaction seam. Tests inject a PGlite-backed runner;
 * production uses the Postgres runner.
 */
export type { TransactionRunner } from '@/lib/db/transactions';

// ---- Validation constants ------------------------------------------------

const REASON_MIN_LENGTH = 1;
const REASON_MAX_LENGTH = 500;

// ---- The action ------------------------------------------------------------

/**
 * Open a manager-initiated deletion request for `params.profileId`. See
 * file header for the full contract.
 *
 * @param params.profileId — UUID of the target profile.
 * @param params.reason — staff-authored justification, 1..500 chars.
 *   NOT stored in the audit row; the reason is operational metadata.
 * @param db — optional `TransactionRunner` for test injection. Omit in
 *   production.
 *
 * @throws SelfEditViolation — when `profileId === session.user.id`.
 * @throws RejectReasonInvalid — when reason length is outside [1, 500].
 * @throws BadRequest — when the profile does not exist OR is already
 *   anonymized (email LIKE 'del:%').
 * @throws InsufficientRoleError — when caller is not `manager+`.
 */
export async function initiateMemberDeletion(
  params: InitiateMemberDeletionParams,
  db?: TransactionRunner,
): Promise<InitiateMemberDeletionResult> {
  // AC5 first-statement defense-in-depth.
  const { profile: actor } = await requireRole('manager');

  // Self-edit guard (ADR-0035 §Self-edit prevention). Fires BEFORE the
  // audit tx so no row is written for a self-edit attempt — cleaner
  // audit posture, no PII to leak (premortem R12).
  if (params.profileId === actor.id) {
    throw new SelfEditViolation('cannot initiate deletion of own profile');
  }

  // Reason length validation. Surfaces as `RejectReasonInvalid` so the
  // page-level error boundary renders a length-mismatch toast distinct
  // from generic auth / DB failures. Fires BEFORE the audit tx.
  const reasonLength = params.reason.length;
  if (reasonLength < REASON_MIN_LENGTH || reasonLength > REASON_MAX_LENGTH) {
    throw new RejectReasonInvalid(
      `initiateMemberDeletion: reason length must be ${REASON_MIN_LENGTH}..${REASON_MAX_LENGTH} chars (got ${reasonLength})`,
    );
  }

  const runner = db ?? postgresTransactionRunner;

  let capturedRequestId: string | null = null;

  await runner.transaction(async (tx) =>
    withAudit(
      tx,
      {
        action: 'admin.member.deletion_initiated',
        targetType: 'profile',
        targetId: params.profileId,
        actorId: actor.id,
      },
      async (txInner) => {
        // SELECT id, email FOR UPDATE — lock the profile row and capture
        // the requester_email pre-anonymization. The email is captured
        // INSIDE the tx (per withAudit invariant — values read outside
        // the tx may be stale by the time the wrapper opens the tx).
        const beforeRead = await txInner.query(
          'SELECT id, email FROM profiles WHERE id = $1 FOR UPDATE',
          [params.profileId],
        );
        const beforeRow = beforeRead.rows[0] as { id: string; email: string } | undefined;
        if (!beforeRow) {
          throw new BadRequest(
            `initiateMemberDeletion: profile not found (id=${params.profileId})`,
          );
        }

        // Pre-anonymization check (premortem-equivalent — no point
        // opening a deletion request against an already-anonymized
        // profile; the email column carries the `del:<sha256>` sentinel
        // after softDeleteProfile commits per ADR-0023).
        if (beforeRow.email.startsWith('del:')) {
          throw new BadRequest(
            `initiateMemberDeletion: profile is already anonymized (id=${params.profileId})`,
          );
        }

        // INSERT INTO privacy_requests. requester_email = captured
        // beforeRow.email so the post-deletion confirmation email has
        // a deliverable address even after softDeleteProfile replaces
        // profiles.email with `del:<hash>` (ADR-0023). resolved_by is
        // NULL — the resolving manager is recorded by approveDeletion
        // (AC25); this action only opens the request.
        const insertResult = await txInner.query(
          `INSERT INTO privacy_requests
             (profile_id, requester_email, kind, status, submitted_at, resolved_by)
           VALUES ($1, $2, $3, $4, now(), NULL)
           RETURNING id`,
          [params.profileId, beforeRow.email, 'delete', 'pending'],
        );
        const insertedRow = insertResult.rows[0] as { id: string } | undefined;
        if (!insertedRow) {
          throw new Error(
            `initiateMemberDeletion: INSERT INTO privacy_requests returned no row (id=${params.profileId})`,
          );
        }
        capturedRequestId = insertedRow.id;

        // Audit before/after — `before = null` (INSERT has no prior
        // state per withAudit conventions); `after = { request_id }`
        // captures the new privacy_requests.id. NO PII (AC28) — the
        // requester_email lives on the privacy_requests row, not in
        // the audit row.
        return {
          before: null,
          after: { request_id: insertedRow.id },
          result: { ok: true as const },
        };
      },
    ),
  );

  // Post-tx cache invalidation (AC35). Wrap in try/catch so a Next-
  // cache outage cannot retroactively roll back the audit-tx commit
  // (premortem R2 — audit-tx commits but post-tx work fails forever).
  try {
    revalidateTag('admin-dashboard-counts');
  } catch (err) {
    // Best-effort — log but do not throw. The dashboard goes 30s
    // stale until the next request rebuilds the cache.
    console.warn('initiateMemberDeletion: cache-invalidation-skipped', {
      profileId: params.profileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (capturedRequestId === null) {
    // Defensive — withAudit's mutate returned cleanly so this should be
    // unreachable. The explicit throw makes the failure mode loud if a
    // future refactor breaks the assignment-inside-callback pattern.
    throw new Error('initiateMemberDeletion: requestId was not captured');
  }

  // ADR-0035 AC31 + premortem R4: emit `admin_action_attempted` AFTER
  // the audit-tx commits + the cache invalidation runs. Payload is
  // the action name + target_type + outcome — NO actor_id, NO
  // profile.id, NO email. Fire-and-forget; the helper internally
  // strips any forbidden keys AND swallows errors so a telemetry
  // outage cannot break the action.
  void trackAdminEvent('admin_action_attempted', {
    action: 'initiateMemberDeletion',
    target_type: 'profile',
    outcome: 'ok',
  });

  return { ok: true, requestId: capturedRequestId };
}
