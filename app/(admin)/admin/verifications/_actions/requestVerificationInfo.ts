import 'server-only';

/**
 * `requestVerificationInfo` — server action that records a staff
 * member's request for additional verification info from a member,
 * without mutating profile state (ADR-0035 AC14, WB.T9).
 *
 * Contract (load-bearing — do not weaken):
 *
 *   1. **First runtime statement is `await requireRole('manager');`** —
 *      AC5 first-await defense-in-depth.
 *
 *   2. **Self-edit guard** throws `SelfEditViolation` BEFORE the audit
 *      tx opens. No audit row is written for a self-edit attempt
 *      (premortem R12 — cleaner audit posture).
 *
 *   3. **`message` length validation 1..1000.** Empty or >1000-char
 *      input throws `MessageInvalid` BEFORE the audit-tx opens. The
 *      typed error is distinct from `RejectReasonInvalid` (different
 *      bounds: 1000 vs 500; different toast copy; different UX).
 *
 *   4. **NO schema mutation.** This action's effect is the email; the
 *      audit row is its forensic breadcrumb. No `UPDATE` or `INSERT`
 *      runs against `profiles` (or any other table) — only the
 *      `INSERT INTO audit_log` that `withAudit` emits.
 *
 *   5. **Audit `before` / `after` shape** (ADR-0035 AC14 + AC28
 *      no-PII contract):
 *        - `before = null` (no prior state — this action does not
 *          mutate the profile).
 *        - `after  = { message_length: <int> }`. The verbatim message
 *          text is NEVER stored in the audit row — only the length is
 *          recorded as a forensic breadcrumb. AC28 explicitly forbids
 *          the literal substring `'message:'` in admin-action source
 *          files' before/after object literals; we honor that by
 *          capturing length only.
 *
 *   6. **Post-tx email stub** — enqueue email per ADR-0025 (currently
 *      blocked; placeholder console.log per spec). The email is the
 *      action; the audit row is the forensic record that the staff
 *      member initiated the request.
 *
 *   7. **Post-tx `revalidateTag('admin-dashboard-counts')`** (AC35).
 *      This action does NOT change the pending-verifications count
 *      (the row stays in the queue) — but the spec invalidates
 *      anyway for consistency of the recent-activity panel. Wrapped
 *      in try/catch so a Next-cache outage cannot retroactively roll
 *      back the audit-tx commit (premortem R2).
 *
 * Production note:
 *   - Default `db` is `postgresTransactionRunner`; tests may inject the
 *     same structural transaction seam.
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import { withAudit } from '@/lib/audit/withAudit';
import { postgresTransactionRunner } from '@/lib/db/postgres-transaction-runner';
import type { TransactionRunner } from '@/lib/db/transactions';

import { SelfEditViolation, MessageInvalid } from '@/app/(admin)/admin/_errors';
import { trackAdminEvent, readVerificationQueueDepth } from '@/lib/analytics/admin-events';

// ---- Public types ---------------------------------------------------------

export interface RequestVerificationInfoParams {
  profileId: string;
  /**
   * 1..1000 chars; emailed to the member verbatim but NOT stored in
   * the audit row (length only). See file header §5.
   */
  message: string;
}

export interface RequestVerificationInfoResult {
  ok: true;
}

/**
 * Shared production/pglite transaction seam.
 */
export type { TransactionRunner };

// ---- Validation constants ------------------------------------------------

const MESSAGE_MIN_LENGTH = 1;
const MESSAGE_MAX_LENGTH = 1000;

// ---- The action ------------------------------------------------------------

/**
 * Request additional info from a member during ID verification. See
 * file header for the full contract.
 *
 * @param params.profileId — UUID of the target profile.
 * @param params.message — staff-authored message, 1..1000 chars. NOT in
 *   the audit row; only the length is recorded.
 * @param db — optional `TransactionRunner` for test injection.
 *
 * @throws SelfEditViolation — when `profileId === session.user.id`.
 * @throws MessageInvalid — when `message` length is outside 1..1000.
 */
export async function requestVerificationInfo(
  params: RequestVerificationInfoParams,
  db?: TransactionRunner,
): Promise<RequestVerificationInfoResult> {
  // AC5 first-statement defense-in-depth.
  const { profile: actor } = await requireRole('manager');

  // Self-edit guard — fires BEFORE the audit tx so no row is written
  // for a self-edit attempt.
  if (params.profileId === actor.id) {
    throw new SelfEditViolation('cannot request verification info on own profile');
  }

  // Message length validation. Fires BEFORE the audit-tx so a bad-input
  // attempt does not write an audit row.
  const messageLength = params.message.length;
  if (messageLength < MESSAGE_MIN_LENGTH || messageLength > MESSAGE_MAX_LENGTH) {
    throw new MessageInvalid(
      `requestVerificationInfo: message length must be ${MESSAGE_MIN_LENGTH}..${MESSAGE_MAX_LENGTH} chars (got ${messageLength})`,
    );
  }

  const runner = db ?? postgresTransactionRunner;

  await runner.transaction(async (tx) =>
    withAudit(
      tx,
      {
        action: 'admin.verification.info_requested',
        targetType: 'profile',
        targetId: params.profileId,
        actorId: actor.id,
      },
      // The withAudit mutate signature is
      // `(tx) => Promise<WithAuditMutateResult<T>>` — see
      // lib/audit/withAudit.ts. This action's mutate is intentionally
      // synchronous because AC14 prohibits schema mutation. The
      // `async` keyword satisfies the signature; the lint rule's
      // "no await" check is a false positive here.
      // eslint-disable-next-line @typescript-eslint/require-await
      async () => {
        // NO schema mutation — this action's effect is the email; the
        // audit row is its forensic breadcrumb. Per AC14 the audit
        // before is null + after captures ONLY message_length (never
        // the verbatim message text — AC28 no-PII contract).
        return {
          before: null,
          after: { message_length: messageLength },
          result: { ok: true as const },
        };
      },
    ),
  );

  // Post-tx email stub. ADR-0025 (transactional email) is blocked; this
  // breadcrumb captures the intent so the wiring is obvious when ADR-0025
  // ships. Wrapped in try/catch — best-effort, same posture as the
  // revalidateTag below.
  try {
    console.log('requestVerificationInfo: email-stub-enqueue', {
      profileId: params.profileId,
      message_length: messageLength,
      // The verbatim message is intentionally NOT included in this
      // breadcrumb — same no-PII posture as the audit row.
    });
  } catch (err) {
    console.warn('requestVerificationInfo: email-stub-skipped', {
      profileId: params.profileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Post-tx cache invalidation (AC35). This action does NOT change the
  // pending-verifications count, but the spec invalidates anyway for
  // consistency of the recent-activity panel (premortem R2 — wrap in
  // try/catch so a Next-cache outage cannot roll back the audit-tx).
  try {
    revalidateTag('admin-dashboard-counts');
  } catch (err) {
    console.warn('requestVerificationInfo: cache-invalidation-skipped', {
      profileId: params.profileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ADR-0035 AC31 + premortem R4: emit `admin_action_attempted` AND
  // `admin_verification_decision`. Both payloads carry NO PII. The
  // queue-depth read is best-effort (returns 0 on failure).
  // Fire-and-forget; the helper internally swallows errors.
  void trackAdminEvent('admin_action_attempted', {
    action: 'requestVerificationInfo',
    target_type: 'profile',
    outcome: 'ok',
  });
  void (async () => {
    const queueDepth = await readVerificationQueueDepth();
    await trackAdminEvent('admin_verification_decision', {
      decision: 'request_info',
      queue_depth_at_decision: queueDepth,
    });
  })();

  return { ok: true };
}
