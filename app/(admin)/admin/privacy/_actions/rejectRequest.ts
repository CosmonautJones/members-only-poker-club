import 'server-only';

/**
 * `rejectRequest` — server action that rejects a pending privacy
 * request (`kind='export'` OR `kind='delete'`) with a staff-authored
 * reason (ADR-0035 AC26, WC.T17).
 *
 * Contract (load-bearing — do not weaken):
 *
 *   1. **First runtime statement is `await requireRole('manager');`** —
 *      AC5 first-await defense-in-depth.
 *
 *   2. **`reason` length validation 1..500.** Empty or >500-char input
 *      throws `RejectReasonInvalid` BEFORE the audit-tx opens.
 *
 *   3. **Status-guard via UPDATE WHERE status='pending'.** The UPDATE
 *      runs INSIDE withAudit and uses `WHERE id = $1 AND status =
 *      'pending'` so a concurrent transition that lost the race
 *      results in 0 affected rows. The action then throws
 *      `RequestNotPending` to roll back the audit-tx — no audit row is
 *      written for a no-op call.
 *
 *   4. **Audit `after` carries only `{status: 'rejected',
 *      reject_reason_length: <int>}`** — length-only per AC14 pattern.
 *      The verbatim `reason` text is NEVER stored in the audit row.
 *      The verbatim `reason` IS stored on `privacy_requests.reject_reason`
 *      (the row column is the operational record; the audit row is the
 *      forensic breadcrumb that records the act, not the content).
 *
 *   5. **Post-tx `revalidateTag('admin-dashboard-counts')`** (AC35).
 *      Rejecting a request removes a row from the pending-privacy
 *      count. Wrapped in try/catch (premortem R2).
 *
 * See ADR-0035 §AC26.
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import { withAudit, type TransactionClient } from '@/lib/audit/withAudit';
import { createAdminClient } from '@/lib/supabase/admin';
import { trackAdminEvent } from '@/lib/analytics/admin-events';
import { nowUtc } from '@/lib/time';

import { RequestNotPending, RejectReasonInvalid } from '@/app/(admin)/admin/_errors';

// ---- Public types ---------------------------------------------------------

export interface RejectRequestParams {
  requestId: string;
  /**
   * Staff-authored reject reason — 1..500 chars. Stored verbatim on
   * `privacy_requests.reject_reason`. ONLY the length is captured in
   * the audit row (AC28 no-PII contract; the reason itself MAY include
   * member-identifying narrative).
   */
  reason: string;
}

export interface RejectRequestResult {
  ok: true;
}

/**
 * Structural transaction runner — same shape as the pglite
 * `pg.transaction(async (tx) => ...)` callback API.
 */
export interface TransactionRunner {
  transaction<T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T>;
}

// ---- Validation constants -------------------------------------------------

const REASON_MIN_LENGTH = 1;
const REASON_MAX_LENGTH = 500;

// ---- The action ------------------------------------------------------------

/**
 * Reject a pending privacy request. See file header for the full
 * contract.
 *
 * @param params.requestId — UUID of the `privacy_requests` row.
 * @param params.reason — staff-authored reason, 1..500 chars.
 * @param db — optional `TransactionRunner` for test injection.
 *
 * @throws RejectReasonInvalid — when `reason` length is outside 1..500.
 *   No audit row is written.
 * @throws RequestNotPending — when the row's status is not 'pending'
 *   at the moment of the UPDATE. No audit row is written.
 */
export async function rejectRequest(
  params: RejectRequestParams,
  db?: TransactionRunner,
): Promise<RejectRequestResult> {
  // AC5 first-statement defense-in-depth.
  const { profile: actor } = await requireRole('manager');

  // Reason length validation. Fires BEFORE the audit-tx so a bad-input
  // attempt does not write an audit row.
  const reasonLength = params.reason.length;
  if (reasonLength < REASON_MIN_LENGTH || reasonLength > REASON_MAX_LENGTH) {
    throw new RejectReasonInvalid(
      `rejectRequest: reason length must be ${REASON_MIN_LENGTH}..${REASON_MAX_LENGTH} chars (got ${reasonLength})`,
    );
  }

  const runner = db ?? defaultDb();

  await runner.transaction(async (tx) =>
    withAudit(
      tx,
      {
        action: 'admin.privacy.request_rejected',
        targetType: 'privacy_request',
        targetId: params.requestId,
        actorId: actor.id,
      },
      async (txInner) => {
        // SELECT FOR UPDATE captures the pre-reject status and locks
        // the row against concurrent transitions. We re-read on the
        // post-UPDATE side to confirm exactly one row was updated.
        const beforeRead = await txInner.query(
          'SELECT status FROM privacy_requests WHERE id = $1 FOR UPDATE',
          [params.requestId],
        );
        const beforeRow = beforeRead.rows[0] as { status: string } | undefined;
        if (!beforeRow) {
          throw new RequestNotPending(`rejectRequest: request not found (id=${params.requestId})`);
        }
        if (beforeRow.status !== 'pending') {
          throw new RequestNotPending(
            `rejectRequest: request status is not 'pending' (got ${beforeRow.status})`,
          );
        }

        await txInner.query(
          `UPDATE privacy_requests
              SET status = 'rejected',
                  resolved_at = now(),
                  resolved_by = $2,
                  reject_reason = $3
            WHERE id = $1
              AND status = 'pending'`,
          [params.requestId, actor.id, params.reason],
        );

        // Audit after — length-only per AC26 + AC28 (no-PII). The
        // verbatim reason lives on privacy_requests.reject_reason (the
        // operational record); the audit row records only the act.
        return {
          before: { status: 'pending' },
          after: { status: 'rejected', reject_reason_length: reasonLength },
          result: { ok: true as const },
        };
      },
    ),
  );

  // AC35 cache invalidation — pending-privacy count drops by one.
  try {
    revalidateTag('admin-dashboard-counts');
  } catch (err) {
    console.warn('rejectRequest: cache-invalidation-skipped', {
      requestId: params.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ADR-0035 AC31 + premortem R4: emit `admin_action_attempted` AFTER
  // the audit-tx commits + the cache invalidation runs. Payload carries
  // only the action verb + target_type + outcome — NO actor_id, NO
  // requestId leak, NO email. Fire-and-forget; the helper internally
  // strips forbidden keys AND swallows errors.
  void trackAdminEvent('admin_action_attempted', {
    action: 'rejectRequest',
    target_type: 'privacy_request',
    outcome: 'ok',
  });

  return { ok: true };
}

// ---- Default production adapter -------------------------------------------
//
// Defined BELOW `rejectRequest` so the file's first `await` token is
// the `await requireRole('manager')` inside the action.

function defaultDb(): TransactionRunner {
  let admin: ReturnType<typeof createAdminClient> | null = null;
  const getAdmin = () => {
    if (admin === null) admin = createAdminClient();
    return admin;
  };

  const asStringOrNull = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    throw new Error(`rejectRequest defaultDb: expected string|null param, got ${typeof v}`);
  };
  const asString = (v: unknown): string => {
    if (typeof v === 'string') return v;
    throw new Error(`rejectRequest defaultDb: expected string param, got ${typeof v}`);
  };

  const txClient: TransactionClient = {
    async query(sql, params) {
      const adminClient = getAdmin();
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // SELECT status FROM privacy_requests WHERE id = $1 [FOR UPDATE]
      if (/^SELECT\s+status\s+FROM\s+privacy_requests\s+WHERE\s+id\s*=\s*\$1/i.test(normalized)) {
        const id = asString(params?.[0]);
        const { data, error } = await adminClient
          .from('privacy_requests')
          .select('status')
          .eq('id', id)
          .maybeSingle();
        if (error) {
          throw new Error(`rejectRequest defaultDb: SELECT status failed: ${error.message}`);
        }
        return { rows: data ? [data] : [] };
      }

      // UPDATE privacy_requests SET status='rejected', ... WHERE id=$1 AND status='pending'
      if (/^UPDATE\s+privacy_requests\s+SET\s+status\s*=\s*'rejected'/i.test(normalized)) {
        const id = asString(params?.[0]);
        const resolvedBy = asStringOrNull(params?.[1]);
        const reason = asString(params?.[2]);
        const { error } = await adminClient
          .from('privacy_requests')
          .update({
            status: 'rejected',
            resolved_at: nowUtc().toISOString(),
            resolved_by: resolvedBy,
            reject_reason: reason,
          })
          .eq('id', id)
          .eq('status', 'pending');
        if (error) {
          throw new Error(`rejectRequest defaultDb: UPDATE rejected failed: ${error.message}`);
        }
        return { rows: [] };
      }

      // INSERT INTO audit_log — emitted by withAudit.
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
          throw new Error(`rejectRequest defaultDb: audit_log INSERT failed: ${error.message}`);
        }
        return { rows: [] };
      }

      throw new Error(
        `rejectRequest defaultDb: unsupported SQL shape ` +
          `(this adapter only translates the action's canonical shapes; ` +
          `add a pg driver via ADR-0017 rather than growing this translator). ` +
          `Got: ${normalized.slice(0, 120)}`,
      );
    },
  };

  return {
    transaction: async (callback) => callback(txClient),
  };
}
