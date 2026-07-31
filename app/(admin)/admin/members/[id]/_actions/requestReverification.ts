import 'server-only';

/**
 * `requestReverification` — server action that resets a member's
 * `id_verified_at` to NULL, pushing them back into the verifications
 * queue with a manager-authored reason captured outside the audit
 * record (ADR-0035 AC16, WC.T13).
 *
 * Contract (load-bearing — do not weaken):
 *
 *   1. **First runtime statement is `await requireRole('manager');`** —
 *      AC5 first-await defense-in-depth.
 *
 *   2. **Self-edit guard** throws `SelfEditViolation` BEFORE the audit
 *      tx opens. No audit row is written for a self-edit attempt; same
 *      reasoning as `changeRole` (cleaner audit posture, no PII to
 *      leak — premortem R12).
 *
 *   3. **`reason` is NOT in the audit row.** Only the length is recorded
 *      (`after = { id_verified_at: null, reason_length: <int> }`). The
 *      verbatim reason text is operational metadata — the staff member
 *      can render it in the next-action UI, but the audit log carries
 *      ONLY the structural transition + the length pin (defense against
 *      PII leaks per AC28).
 *
 *   4. **Audit `before` / `after` shape** — `before = { id_verified_at: <iso> }`
 *      where the value is the pre-reset timestamp (ISO string OR null if
 *      the member was never verified); `after = { id_verified_at: null,
 *      reason_length: <int> }`. The pre-reset null case is legal — the
 *      action is idempotent for "already in the queue" members so a
 *      manager can re-request verification info without surfacing a
 *      "no-op" error.
 *
 *   5. **Post-tx `revalidateTag('admin-dashboard-counts')`** (AC35) —
 *      this action pushes a row back into pending-verifications, so the
 *      count actively changes. The call is wrapped in try/catch so a
 *      Next-cache outage cannot retroactively roll back the audit-tx
 *      commit (premortem R2).
 *
 * Production defaults to the shared Postgres transaction runner. Tests
 * inject the same `TransactionRunner` seam with PGlite.
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import { withAudit } from '@/lib/audit/withAudit';
import { postgresTransactionRunner } from '@/lib/db/postgres-transaction-runner';
import type { TransactionRunner } from '@/lib/db/transactions';

import { SelfEditViolation } from '@/app/(admin)/admin/_errors';
import { trackAdminEvent } from '@/lib/analytics/admin-events';

// ---- Public types ---------------------------------------------------------

export interface RequestReverificationParams {
  profileId: string;
  /** 1..1000 chars; rendered in the next-action UI but NOT in the audit. */
  reason: string;
}

export interface RequestReverificationResult {
  ok: true;
}

/**
 * Shared transaction seam. Tests inject a PGlite-backed runner;
 * production uses the Postgres runner.
 */
export type { TransactionRunner } from '@/lib/db/transactions';

// ---- Validation constants ------------------------------------------------

const REASON_MIN_LENGTH = 1;
const REASON_MAX_LENGTH = 1000;

// ---- The action ------------------------------------------------------------

/**
 * Reset a member's `id_verified_at` to NULL and write an audit row
 * recording the structural transition + the reason length.
 *
 * @param params.profileId — UUID of the target profile.
 * @param params.reason — staff-authored reason, 1..1000 chars. NOT in
 *   the audit row; only the length is recorded.
 * @param db — optional `TransactionRunner` for test injection.
 *
 * @throws SelfEditViolation — when `profileId === session.user.id`.
 * @throws RangeError — when `reason` is empty or longer than 1000 chars.
 */
export async function requestReverification(
  params: RequestReverificationParams,
  db?: TransactionRunner,
): Promise<RequestReverificationResult> {
  // AC5 first-statement defense-in-depth.
  const { profile: actor } = await requireRole('manager');

  // Self-edit guard — fires BEFORE the audit tx so no row is written
  // for a self-edit attempt.
  if (params.profileId === actor.id) {
    throw new SelfEditViolation('cannot request reverification on own profile');
  }

  // Reason length validation. The reason is NOT in the audit row, but
  // we still validate it BEFORE the tx so a future Slice 5 task that
  // adds reason-storage (e.g. a `verification_requests` table) can
  // reuse this validation as-is.
  const reasonLength = params.reason.length;
  if (reasonLength < REASON_MIN_LENGTH || reasonLength > REASON_MAX_LENGTH) {
    throw new RangeError(
      `requestReverification: reason length must be ${REASON_MIN_LENGTH}..${REASON_MAX_LENGTH} chars (got ${reasonLength})`,
    );
  }

  const runner = db ?? postgresTransactionRunner;

  await runner.transaction(async (tx) =>
    withAudit(
      tx,
      {
        action: 'admin.member.reverification_requested',
        targetType: 'profile',
        targetId: params.profileId,
        actorId: actor.id,
      },
      async (txInner) => {
        // SELECT FOR UPDATE captures the pre-reset id_verified_at AND
        // locks the row against concurrent verifications inside the tx.
        const beforeRead = await txInner.query(
          'SELECT id_verified_at FROM profiles WHERE id = $1 FOR UPDATE',
          [params.profileId],
        );
        const beforeRow = beforeRead.rows[0] as { id_verified_at: string | null } | undefined;
        if (!beforeRow) {
          throw new Error(`requestReverification: profile not found (id=${params.profileId})`);
        }

        await txInner.query('UPDATE profiles SET id_verified_at = NULL WHERE id = $1', [
          params.profileId,
        ]);

        // Audit before / after — structural transition + reason length.
        // The `reason` itself is NOT in the audit row. The `before`
        // value MAY be null (member never verified) — that is a legal
        // shape per the action's idempotent contract.
        return {
          before: { id_verified_at: beforeRow.id_verified_at ?? null },
          after: { id_verified_at: null, reason_length: reasonLength },
          result: { ok: true as const },
        };
      },
    ),
  );

  // Post-tx cache invalidation (AC35) — this action pushes a row back
  // into pending-verifications, so the count actively changes.
  try {
    revalidateTag('admin-dashboard-counts');
  } catch (err) {
    console.warn('requestReverification: cache-invalidation-skipped', {
      profileId: params.profileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ADR-0035 AC31 + premortem R4: emit `admin_action_attempted` AFTER
  // the audit-tx commits + the cache invalidation runs. NO PII.
  // Fire-and-forget; the helper internally swallows errors.
  void trackAdminEvent('admin_action_attempted', {
    action: 'requestReverification',
    target_type: 'profile',
    outcome: 'ok',
  });

  return { ok: true };
}
