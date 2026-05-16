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
 * Production note:
 *   - Same `db` injection pattern as `changeRole`. See that file's header
 *     for the supabase-js / pg-driver migration plan (ADR-0017).
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import { withAudit, type TransactionClient } from '@/lib/audit/withAudit';
import { createAdminClient } from '@/lib/supabase/admin';

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
 * Structural transaction runner — mirrors `changeRole.ts`. Tests inject
 * a pglite-backed adapter; production uses the supabase-admin shim.
 */
export interface TransactionRunner {
  transaction<T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T>;
}

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

  const runner = db ?? defaultDb();

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

// ---- Default production adapter -------------------------------------------
//
// Defined BELOW `requestReverification` so the file's first `await`
// token is the `await requireRole('manager')` inside the action.
// AC5's regex-tier defense-in-depth walker scans for the first
// `\bawait\b` in source order; placing the adapter (which contains
// internal `await` calls against the supabase client) above the
// action would silently fail the gate. Function declarations are
// hoisted, so the `db ?? defaultDb()` reference resolves correctly
// despite the textual ordering.

/**
 * Production `TransactionRunner` — see `changeRole.ts` §Production note
 * for the supabase-js no-real-tx caveat. This action issues three query
 * shapes:
 *
 *   (1) SELECT id_verified_at FROM profiles WHERE id = $1 FOR UPDATE
 *   (2) UPDATE profiles SET id_verified_at = NULL WHERE id = $1
 *   (3) INSERT INTO audit_log (...)  ← issued by withAudit itself
 *
 * Any other SQL shape throws so the failure mode is loud — see the
 * SAFETY POSTURE note in `changeRole.ts`.
 */
function defaultDb(): TransactionRunner {
  let admin: ReturnType<typeof createAdminClient> | null = null;
  const getAdmin = () => {
    if (admin === null) admin = createAdminClient();
    return admin;
  };

  // Safe string-or-null coercion — see changeRole.ts for the rationale.
  const asStringOrNull = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    throw new Error(`requestReverification defaultDb: expected string|null param, got ${typeof v}`);
  };
  const asString = (v: unknown): string => {
    if (typeof v === 'string') return v;
    throw new Error(`requestReverification defaultDb: expected string param, got ${typeof v}`);
  };

  const txClient: TransactionClient = {
    async query(sql, params) {
      const adminClient = getAdmin();
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // Shape (1): SELECT id_verified_at FROM profiles WHERE id = $1 [FOR UPDATE]
      if (/^SELECT\s+id_verified_at\s+FROM\s+profiles\s+WHERE\s+id\s*=\s*\$1/i.test(normalized)) {
        const id = asString(params?.[0]);
        const { data, error } = await adminClient
          .from('profiles')
          .select('id_verified_at')
          .eq('id', id)
          .maybeSingle();
        if (error) {
          throw new Error(
            `requestReverification defaultDb: SELECT id_verified_at failed: ${error.message}`,
          );
        }
        return { rows: data ? [data] : [] };
      }

      // Shape (2): UPDATE profiles SET id_verified_at = NULL WHERE id = $1
      if (
        /^UPDATE\s+profiles\s+SET\s+id_verified_at\s*=\s*NULL\s+WHERE\s+id\s*=\s*\$1/i.test(
          normalized,
        )
      ) {
        const id = asString(params?.[0]);
        const { error } = await adminClient
          .from('profiles')
          .update({ id_verified_at: null })
          .eq('id', id);
        if (error) {
          throw new Error(
            `requestReverification defaultDb: UPDATE id_verified_at failed: ${error.message}`,
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
            `requestReverification defaultDb: audit_log INSERT failed: ${error.message}`,
          );
        }
        return { rows: [] };
      }

      throw new Error(
        `requestReverification defaultDb: unsupported SQL shape ` +
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
