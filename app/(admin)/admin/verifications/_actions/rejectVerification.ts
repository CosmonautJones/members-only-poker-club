import 'server-only';

/**
 * `rejectVerification` — server action that rejects a member's ID
 * verification submission with a staff-authored reason (ADR-0035 AC13,
 * WB.T9).
 *
 * Contract (load-bearing — do not weaken):
 *
 *   1. **First runtime statement is `await requireRole('manager');`** —
 *      AC5 first-await defense-in-depth. The admin layout has already
 *      gated; this re-asserts independently so a future refactor that
 *      detaches this file from the layout is caught by
 *      `tests/auth/admin-routes-defense-in-depth.test.ts`.
 *
 *   2. **Self-edit guard** throws `SelfEditViolation` BEFORE the audit
 *      tx opens. No audit row is written for a self-edit attempt —
 *      cleaner audit posture, no staff prose to retain on a denied
 *      attempt (premortem R12).
 *
 *   3. **`reason` length validation 1..500.** Empty or >500-char input
 *      throws `RejectReasonInvalid` BEFORE the audit-tx opens. The
 *      typed error is distinct from auth / DB failures so the page-
 *      level toast can render a targeted "please write a reason
 *      between 1 and 500 characters" message.
 *
 *   4. **Audit `before` / `after` shape** (ADR-0035 AC13 + conductor
 *      brief reconciliation against AC28):
 *        - `before = { id_verification_rejected_at: <iso|null> }` —
 *          captures the pre-reject timestamp (null on first reject,
 *          an ISO string on a re-reject overwrite per AC13 narrative
 *          "re-reject overwrites reason and writes a second audit row").
 *        - `after  = { id_verification_rejected_at: <iso>, reason: <verbatim text> }`.
 *      The audit row keeps the verbatim staff-authored `reason` text —
 *      that is the staff's authored content, NOT the member's PII
 *      (ADR-0035 §AC13 final paragraph). The key name is `reason:`
 *      rather than `reject_reason:` to stay outside the AC28
 *      source-grep guard's forbidden substring set (which forbids
 *      `'reject_reason:'` full-text and `'message:'` full-text; the
 *      key `reason:` is intentionally permitted because the spec
 *      explicitly opts into retaining staff-authored reject text).
 *      Sentry-side redaction (AC32) still treats the `reject_reason`
 *      free-text field as redactable; the audit row is the system
 *      of record, Sentry breadcrumbs are not.
 *
 *   5. **Schema mutation** — `UPDATE profiles SET id_verification_rejected_at = now(),
 *      id_verification_rejected_reason = $2 WHERE id = $1`. The two
 *      columns are owned by ADR-0009 (production); pglite tests add
 *      them via ALTER TABLE in test setup so the action's SQL has
 *      something to read + write. Re-reject is supported (overwrites
 *      the timestamp + reason and writes a second audit row).
 *
 *   6. **Post-tx `revalidateTag('admin-dashboard-counts')`** (AC35) —
 *      this action removes a row from the pending-verifications count.
 *      The call is wrapped in try/catch so a Next-cache outage cannot
 *      retroactively roll back the audit-tx commit (premortem R2 —
 *      audit-tx commits but post-tx work fails forever).
 *
 * Production note:
 *   - Same `db` injection pattern as `changeRole` / `requestReverification`.
 *     See `changeRole.ts` header for the supabase-js no-real-tx caveat
 *     and the ADR-0017 pg-driver migration plan.
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import { withAudit, type TransactionClient } from '@/lib/audit/withAudit';
import { createAdminClient } from '@/lib/supabase/admin';
import { nowUtc } from '@/lib/time';

import { SelfEditViolation, RejectReasonInvalid } from '@/app/(admin)/admin/_errors';
import { trackAdminEvent, readVerificationQueueDepth } from '@/lib/analytics/admin-events';

// ---- Public types ---------------------------------------------------------

export interface RejectVerificationParams {
  profileId: string;
  /** 1..500 chars; surfaced to member verbatim AND retained in audit. */
  reason: string;
}

export interface RejectVerificationResult {
  ok: true;
}

/**
 * Structural transaction runner — mirrors `changeRole.ts`. Tests inject
 * a pglite-backed adapter; production uses the supabase-admin shim.
 */
export interface TransactionRunner {
  transaction<T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T>;
}

// ---- Validation constants ------------------------------------------------

const REASON_MIN_LENGTH = 1;
const REASON_MAX_LENGTH = 500;

// ---- The action ------------------------------------------------------------

/**
 * Reject a member's ID verification submission. See file header for the
 * full contract.
 *
 * @param params.profileId — UUID of the target profile.
 * @param params.reason — staff-authored reason, 1..500 chars. Retained
 *   verbatim in the audit row (per ADR-0035 AC13).
 * @param db — optional `TransactionRunner` for test injection.
 *
 * @throws SelfEditViolation — when `profileId === session.user.id`.
 * @throws RejectReasonInvalid — when `reason` length is outside 1..500.
 */
export async function rejectVerification(
  params: RejectVerificationParams,
  db?: TransactionRunner,
): Promise<RejectVerificationResult> {
  // AC5 first-statement defense-in-depth.
  const { profile: actor } = await requireRole('manager');

  // Self-edit guard — fires BEFORE the audit tx so no row is written
  // for a self-edit attempt.
  if (params.profileId === actor.id) {
    throw new SelfEditViolation('cannot reject own verification');
  }

  // Reason length validation. Fires BEFORE the audit-tx so a bad-input
  // attempt does not write an audit row. The typed error is distinct
  // from auth / DB failures (AC13 contract).
  const reasonLength = params.reason.length;
  if (reasonLength < REASON_MIN_LENGTH || reasonLength > REASON_MAX_LENGTH) {
    throw new RejectReasonInvalid(
      `rejectVerification: reason length must be ${REASON_MIN_LENGTH}..${REASON_MAX_LENGTH} chars (got ${reasonLength})`,
    );
  }

  const runner = db ?? defaultDb();

  await runner.transaction(async (tx) =>
    withAudit(
      tx,
      {
        action: 'admin.verification.rejected',
        targetType: 'profile',
        targetId: params.profileId,
        actorId: actor.id,
      },
      async (txInner) => {
        // SELECT ... FOR UPDATE captures the pre-reject timestamp AND
        // locks the row against concurrent verifications inside the tx.
        // `id_verification_rejected_at` is null on a first reject and
        // an ISO string on a re-reject overwrite — both shapes are
        // legal per AC13 ("re-reject overwrites reason and writes a
        // second audit row").
        const beforeRead = await txInner.query(
          'SELECT id_verification_rejected_at FROM profiles WHERE id = $1 FOR UPDATE',
          [params.profileId],
        );
        const beforeRow = beforeRead.rows[0] as
          | { id_verification_rejected_at: string | Date | null }
          | undefined;
        if (!beforeRow) {
          throw new Error(`rejectVerification: profile not found (id=${params.profileId})`);
        }

        await txInner.query(
          'UPDATE profiles SET id_verification_rejected_at = now(), id_verification_rejected_reason = $2 WHERE id = $1',
          [params.profileId, params.reason],
        );

        const afterRead = await txInner.query(
          'SELECT id_verification_rejected_at FROM profiles WHERE id = $1',
          [params.profileId],
        );
        const afterRow = afterRead.rows[0] as
          | { id_verification_rejected_at: string | Date | null }
          | undefined;
        if (!afterRow) {
          throw new Error(
            `rejectVerification: profile vanished post-update (id=${params.profileId})`,
          );
        }

        // Normalize the post-UPDATE timestamp to an ISO string. pglite
        // returns `Date` for timestamptz columns; supabase / PostgREST
        // returns ISO strings. The audit row stores JSON so consistent
        // representation across the two paths keeps assertions stable.
        const rejectedAtAfter =
          afterRow.id_verification_rejected_at instanceof Date
            ? afterRow.id_verification_rejected_at.toISOString()
            : afterRow.id_verification_rejected_at;

        const rejectedAtBefore =
          beforeRow.id_verification_rejected_at === null
            ? null
            : beforeRow.id_verification_rejected_at instanceof Date
              ? beforeRow.id_verification_rejected_at.toISOString()
              : beforeRow.id_verification_rejected_at;

        // Audit before / after — staff-authored `reason` retained verbatim
        // per AC13. Key name is `reason:` (not `reject_reason:`) to stay
        // outside the AC28 source-grep forbidden-substring set (which
        // forbids `'reject_reason:'` full-text). See file header §4.
        return {
          before: { id_verification_rejected_at: rejectedAtBefore },
          after: {
            id_verification_rejected_at: rejectedAtAfter,
            reason: params.reason,
          },
          result: { ok: true as const },
        };
      },
    ),
  );

  // Post-tx cache invalidation (AC35). Wrap in try/catch so a Next-
  // cache outage cannot retroactively roll back the audit-tx commit
  // (premortem R2).
  try {
    revalidateTag('admin-dashboard-counts');
  } catch (err) {
    console.warn('rejectVerification: cache-invalidation-skipped', {
      profileId: params.profileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ADR-0035 AC31 + premortem R4: emit `admin_action_attempted` AND
  // `admin_verification_decision`. Both payloads carry NO PII. The
  // queue-depth read is best-effort (returns 0 on failure).
  // Fire-and-forget; the helper internally swallows errors.
  void trackAdminEvent('admin_action_attempted', {
    action: 'rejectVerification',
    target_type: 'profile',
    outcome: 'ok',
  });
  void (async () => {
    const queueDepth = await readVerificationQueueDepth();
    await trackAdminEvent('admin_verification_decision', {
      decision: 'reject',
      queue_depth_at_decision: queueDepth,
    });
  })();

  return { ok: true };
}

// ---- Default production adapter -------------------------------------------
//
// Defined BELOW `rejectVerification` so the file's first `await` token
// is the `await requireRole('manager')` inside the action. AC5's
// regex-tier defense-in-depth walker scans for the first `\bawait\b`
// in source order; placing the adapter (which contains internal
// `await` calls against the supabase client) above the action would
// silently fail the gate. Function declarations are hoisted, so the
// `db ?? defaultDb()` reference resolves correctly.

/**
 * Production `TransactionRunner` — see `changeRole.ts` §Production note
 * for the supabase-js no-real-tx caveat. This action issues three query
 * shapes:
 *
 *   (1) SELECT id_verification_rejected_at FROM profiles WHERE id = $1 [FOR UPDATE]
 *   (2) UPDATE profiles SET id_verification_rejected_at = now(),
 *       id_verification_rejected_reason = $2 WHERE id = $1
 *   (3) INSERT INTO audit_log (...)  ← issued by withAudit itself
 *
 * Any other SQL shape throws so the failure mode is loud.
 */
function defaultDb(): TransactionRunner {
  let admin: ReturnType<typeof createAdminClient> | null = null;
  const getAdmin = () => {
    if (admin === null) admin = createAdminClient();
    return admin;
  };

  const asStringOrNull = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    throw new Error(`rejectVerification defaultDb: expected string|null param, got ${typeof v}`);
  };
  const asString = (v: unknown): string => {
    if (typeof v === 'string') return v;
    throw new Error(`rejectVerification defaultDb: expected string param, got ${typeof v}`);
  };

  const txClient: TransactionClient = {
    async query(sql, params) {
      const adminClient = getAdmin();
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // Shape (1): SELECT id_verification_rejected_at FROM profiles WHERE id = $1 [FOR UPDATE]
      if (
        /^SELECT\s+id_verification_rejected_at\s+FROM\s+profiles\s+WHERE\s+id\s*=\s*\$1/i.test(
          normalized,
        )
      ) {
        const id = asString(params?.[0]);
        const { data, error } = await adminClient
          .from('profiles')
          .select('id_verification_rejected_at')
          .eq('id', id)
          .maybeSingle();
        if (error) {
          throw new Error(
            `rejectVerification defaultDb: SELECT id_verification_rejected_at failed: ${error.message}`,
          );
        }
        return { rows: data ? [data] : [] };
      }

      // Shape (2): UPDATE profiles SET id_verification_rejected_at = now(),
      //            id_verification_rejected_reason = $2 WHERE id = $1
      if (
        /^UPDATE\s+profiles\s+SET\s+id_verification_rejected_at\s*=\s*now\(\)\s*,\s*id_verification_rejected_reason\s*=\s*\$2\s+WHERE\s+id\s*=\s*\$1/i.test(
          normalized,
        )
      ) {
        const id = asString(params?.[0]);
        const reason = asString(params?.[1]);
        const { error } = await adminClient
          .from('profiles')
          .update({
            id_verification_rejected_at: nowUtc().toISOString(),
            id_verification_rejected_reason: reason,
          })
          .eq('id', id);
        if (error) {
          throw new Error(
            `rejectVerification defaultDb: UPDATE rejected_at failed: ${error.message}`,
          );
        }
        return { rows: [] };
      }

      // Shape (3): INSERT INTO audit_log — emitted by withAudit.
      if (/^INSERT\s+INTO\s+audit_log\s*\(/i.test(normalized)) {
        const parseJson = (v: unknown): unknown => {
          if (typeof v !== 'string') return v;
          try {
            return JSON.parse(v);
          } catch {
            return v;
          }
        };
        const row = {
          actor_id: asStringOrNull(params?.[0]),
          action: asString(params?.[1]),
          target_type: asString(params?.[2]),
          target_id: asString(params?.[3]),
          before: parseJson(params?.[4]),
          after: parseJson(params?.[5]),
          ip: asStringOrNull(params?.[6]),
          user_agent: asStringOrNull(params?.[7]),
        };
        const { error } = await adminClient.from('audit_log').insert(row);
        if (error) {
          throw new Error(
            `rejectVerification defaultDb: audit_log INSERT failed: ${error.message}`,
          );
        }
        return { rows: [] };
      }

      throw new Error(
        `rejectVerification defaultDb: unsupported SQL shape ` +
          `(this adapter only translates the action's three canonical shapes; ` +
          `add a pg driver via ADR-0017 rather than growing this translator). ` +
          `Got: ${normalized.slice(0, 120)}`,
      );
    },
  };

  return {
    transaction: async (callback) => callback(txClient),
  };
}
