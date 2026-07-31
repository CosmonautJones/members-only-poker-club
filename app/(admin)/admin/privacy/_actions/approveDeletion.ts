import 'server-only';

/**
 * `approveDeletion` — server action that approves a member's deletion
 * request by anonymizing their profile via `softDeleteProfile`
 * (ADR-0023) inside the audit-tx, then marking the request row
 * `status='completed'` (ADR-0035 AC25, WC.T17).
 *
 * ORDER IS LOAD-BEARING (premortem R10) — DO NOT REORDER:
 *
 *   (1) SELECT ... FOR UPDATE on the privacy_requests row.
 *   (2) Assert status='pending' else throw RequestNotPending.
 *   (3) Assert confirmEmail === requester_email else throw
 *       ConfirmEmailMismatch. **This is the load-bearing typed-
 *       confirmation guard** — a compromised manager session that
 *       POSTs directly to the action bypasses the client-side typed
 *       dialog, so the server-side equality check is the last defense
 *       against the "wrong member deleted" premortem.
 *   (4) Call `softDeleteProfile(profile_id, tx)` (ADR-0023 helper).
 *       The helper runs inside the same tx via the structural
 *       `TransactionClient` shape — anonymization and audit row commit
 *       atomically.
 *   (5) UPDATE privacy_requests SET status='completed', resolved_at,
 *       resolved_by.
 *
 * Contract (load-bearing — do not weaken):
 *
 *   1. **First runtime statement is `await requireRole('manager');`** —
 *      AC5 first-await defense-in-depth.
 *
 *   2. **Single audit event with NO PII.** `withAudit('admin.privacy.
 *      deletion_approved', 'profile', profile_id)` emits one row with
 *      `before = { deleted_at: null }` and
 *      `after = { deleted_at: '<iso>', request_id }`. The verbatim
 *      `requester_email` is NEVER written into before/after — the
 *      AC28 cross-cutting source-grep test pins this.
 *
 *   3. **softDeleteProfile NOT called on mismatch.** The
 *      ConfirmEmailMismatch throw fires INSIDE the audit-tx, AFTER
 *      SELECT FOR UPDATE but BEFORE softDeleteProfile. withAudit
 *      propagates the throw and the caller's tx wrapper rolls back —
 *      no anonymization, no audit row, no privacy_requests UPDATE.
 *
 *   4. **Post-tx `revalidateTag('admin-dashboard-counts')`** (AC35) —
 *      removing a row from the pending-privacy count. Wrapped in
 *      try/catch (premortem R2).
 *
 *   5. **Post-tx confirmation email stub (ADR-0025 blocked).** The
 *      captured `requester_email` is used to send the confirmation
 *      email; the email send is best-effort and logged. The
 *      `requester_email` itself is NEVER written to the audit row —
 *      it is captured into a local variable inside the audit-tx and
 *      consumed by the email stub AFTER the tx commits.
 *
 * See ADR-0035 §AC25 + premortem R10.
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import { withAudit } from '@/lib/audit/withAudit';
import { postgresTransactionRunner } from '@/lib/db/postgres-transaction-runner';
import type { TransactionRunner } from '@/lib/db/transactions';
import { softDeleteProfile } from '@/lib/privacy/soft-delete';
import { trackAdminEvent } from '@/lib/analytics/admin-events';

import { RequestNotPending, ConfirmEmailMismatch } from '@/app/(admin)/admin/_errors';

// ---- Public types ---------------------------------------------------------

export interface ApproveDeletionParams {
  requestId: string;
  /**
   * Typed-confirmation phrase — MUST exactly equal the row's
   * `requester_email` captured at submission time. The server-side
   * equality check is the load-bearing guard against the premortem R10
   * "wrong member deleted" scenario.
   */
  confirmEmail: string;
}

export interface ApproveDeletionResult {
  ok: true;
}

/**
 * Structural transaction runner — same shape as the pglite
 * `pg.transaction(async (tx) => ...)` callback API.
 */
export type { TransactionRunner };

// ---- The action ------------------------------------------------------------

/**
 * Approve a pending deletion request. See file header for the full
 * contract.
 *
 * @param params.requestId — UUID of the `privacy_requests` row.
 * @param params.confirmEmail — typed-confirmation phrase; MUST equal
 *   the row's captured `requester_email`.
 * @param db — optional `TransactionRunner` for test injection.
 *
 * @throws RequestNotPending — when the row's status is not 'pending'
 *   OR its kind is not 'delete'.
 * @throws ConfirmEmailMismatch — when `confirmEmail` does not equal
 *   the row's `requester_email`. softDeleteProfile is NOT called and
 *   no audit row is written.
 */
export async function approveDeletion(
  params: ApproveDeletionParams,
  db?: TransactionRunner,
): Promise<ApproveDeletionResult> {
  // AC5 first-statement defense-in-depth.
  const { profile: actor } = await requireRole('manager');

  const runner = db ?? postgresTransactionRunner;

  // Pre-probe outside the audit-tx to discover profile_id for the
  // audit row's targetId. profile_id on a privacy_requests row is
  // immutable (no UPDATE path mutates it — see ADR-0035 §Data Model
  // Deltas), so reading it here without a FOR UPDATE lock is safe.
  // The race-free guard remains inside the audit-tx via the
  // SELECT FOR UPDATE + status='pending' assertion (premortem R10
  // order-is-load-bearing posture).
  //
  // If the row is missing OR not in 'pending' status, we throw the
  // typed error here BEFORE the audit-tx opens — no audit row is
  // written for a missing row (the row id might be a typo / stale
  // queue link, not an operational event worth auditing).
  const probeResult = await runner.transaction(async (tx) => {
    const probe = await tx.query('SELECT profile_id FROM privacy_requests WHERE id = $1', [
      params.requestId,
    ]);
    const row = probe.rows[0] as { profile_id: string } | undefined;
    return row ?? null;
  });
  if (!probeResult) {
    throw new RequestNotPending(`approveDeletion: request not found (id=${params.requestId})`);
  }
  const profileId = probeResult.profile_id;

  // The captured email is bound INSIDE the audit-tx and consumed
  // post-tx by the email stub. Declared at outer scope so the
  // closure captures cleanly across the tx boundary.
  // (Typed via a mutable wrapper so TS doesn't narrow to `never` after
  // the closure write — `let s: string | null = null` would otherwise
  // be flow-narrowed to `null` since the assignment is in a callback.)
  const captured: { requesterEmail: string | null } = { requesterEmail: null };

  await runner.transaction(async (tx) => {
    // The SELECT FOR UPDATE + assertions + softDeleteProfile +
    // UPDATE privacy_requests run inside the audit-tx so the
    // anonymization and the audit row commit atomically. The audit
    // row is emitted by withAudit at the end of mutate; if any of
    // the steps below throws, withAudit propagates the error and
    // the tx wrapper rolls back.
    return withAudit(
      tx,
      {
        action: 'admin.privacy.deletion_approved',
        targetType: 'profile',
        targetId: profileId,
        actorId: actor.id,
      },
      async (txInner) => {
        // (1) SELECT FOR UPDATE — locks the row.
        const beforeRead = await txInner.query(
          `SELECT profile_id, requester_email, kind, status
             FROM privacy_requests
            WHERE id = $1
              FOR UPDATE`,
          [params.requestId],
        );
        const beforeRow = beforeRead.rows[0] as
          | {
              profile_id: string;
              requester_email: string;
              kind: string;
              status: string;
            }
          | undefined;
        if (!beforeRow) {
          throw new RequestNotPending(
            `approveDeletion: request not found (id=${params.requestId})`,
          );
        }
        // (2) status='pending' assertion.
        if (beforeRow.kind !== 'delete') {
          throw new RequestNotPending(
            `approveDeletion: request kind is not 'delete' (got ${beforeRow.kind})`,
          );
        }
        if (beforeRow.status !== 'pending') {
          throw new RequestNotPending(
            `approveDeletion: request status is not 'pending' (got ${beforeRow.status})`,
          );
        }
        // (3) ConfirmEmailMismatch — LOAD-BEARING premortem R10 guard.
        // The throw fires BEFORE softDeleteProfile so no anonymization
        // happens on mismatch.
        if (params.confirmEmail !== beforeRow.requester_email) {
          throw new ConfirmEmailMismatch(
            'approveDeletion: confirmEmail does not match requester_email',
          );
        }
        captured.requesterEmail = beforeRow.requester_email;

        // (4) softDeleteProfile — the ADR-0023 helper runs inside the
        // same tx via the structural TransactionClient shape.
        await softDeleteProfile(beforeRow.profile_id, txInner);

        // (5) UPDATE privacy_requests status='completed'.
        await txInner.query(
          `UPDATE privacy_requests
              SET status = 'completed',
                  resolved_at = now(),
                  resolved_by = $2
            WHERE id = $1`,
          [params.requestId, actor.id],
        );

        // Re-read profiles.deleted_at to put on the audit row's after.
        // The audit row's before captures null (the soft-delete helper
        // guarantees the profile was non-deleted at the SELECT FOR
        // UPDATE moment via its `WHERE deleted_at IS NULL` clause).
        const afterRead = await txInner.query('SELECT deleted_at FROM profiles WHERE id = $1', [
          beforeRow.profile_id,
        ]);
        const afterRow = afterRead.rows[0] as { deleted_at: string | Date | null } | undefined;
        const deletedAtAfter =
          afterRow?.deleted_at instanceof Date
            ? afterRow.deleted_at.toISOString()
            : (afterRow?.deleted_at ?? null);

        // Audit before/after — NO PII (AC28). The captured
        // requester_email is consumed post-tx by the email stub but
        // NEVER written into the audit row.
        return {
          before: { deleted_at: null },
          after: { deleted_at: deletedAtAfter, request_id: params.requestId },
          result: { ok: true as const, profile_id: beforeRow.profile_id },
        };
      },
    );
  });

  // AC35 cache invalidation — pending-privacy count drops by one.
  try {
    revalidateTag('admin-dashboard-counts');
  } catch (err) {
    console.warn('approveDeletion: cache-invalidation-skipped', {
      requestId: params.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Confirmation email stub (ADR-0025 blocked). The captured
  // requester_email is consumed here but NEVER logged verbatim — the
  // breadcrumb records only the length so the audit posture matches
  // the email-only-via-Sentry-redaction-list contract (AC32).
  try {
    console.info('approveDeletion: confirmation-email-enqueue-stub', {
      requestId: params.requestId,
      requester_email_length: captured.requesterEmail !== null ? captured.requesterEmail.length : 0,
    });
  } catch (err) {
    console.warn('approveDeletion: email-stub-skipped', {
      requestId: params.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ADR-0035 AC31 + premortem R4: emit `admin_action_attempted` AFTER
  // the audit-tx commits + the cache invalidation + email stub run.
  // Payload carries only the action verb + target_type + outcome — NO
  // actor_id, NO profile.id, NO email. Fire-and-forget; the helper
  // internally strips any forbidden keys AND swallows errors so a
  // telemetry outage cannot break the action.
  void trackAdminEvent('admin_action_attempted', {
    action: 'approveDeletion',
    target_type: 'profile',
    outcome: 'ok',
  });

  return { ok: true };
}
