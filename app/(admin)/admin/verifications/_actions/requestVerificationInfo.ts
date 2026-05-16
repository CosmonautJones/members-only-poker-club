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
 *   - Same `db` injection pattern as `changeRole`. See `changeRole.ts`
 *     header for the supabase-js no-real-tx caveat and the ADR-0017
 *     pg-driver migration plan.
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import { withAudit, type TransactionClient } from '@/lib/audit/withAudit';
import { createAdminClient } from '@/lib/supabase/admin';

import { SelfEditViolation, MessageInvalid } from '@/app/(admin)/admin/_errors';
import {
  trackAdminEvent,
  readVerificationQueueDepth,
} from '@/lib/analytics/admin-events';

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
 * Structural transaction runner — mirrors `changeRole.ts`. Tests inject
 * a pglite-backed adapter; production uses the supabase-admin shim.
 */
export interface TransactionRunner {
  transaction<T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T>;
}

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

  const runner = db ?? defaultDb();

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

// ---- Default production adapter -------------------------------------------
//
// Defined BELOW `requestVerificationInfo` so the file's first `await`
// token is the `await requireRole('manager')` inside the action.
// AC5's regex-tier defense-in-depth walker scans for the first
// `\bawait\b` in source order.

/**
 * Production `TransactionRunner` — see `changeRole.ts` §Production note
 * for the supabase-js no-real-tx caveat. This action issues only ONE
 * query shape:
 *
 *   (1) INSERT INTO audit_log (...)  ← issued by withAudit itself
 *
 * No `profiles` reads or writes — see file header §4.
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
    throw new Error(
      `requestVerificationInfo defaultDb: expected string|null param, got ${typeof v}`,
    );
  };
  const asString = (v: unknown): string => {
    if (typeof v === 'string') return v;
    throw new Error(
      `requestVerificationInfo defaultDb: expected string param, got ${typeof v}`,
    );
  };

  const txClient: TransactionClient = {
    async query(sql, params) {
      const adminClient = getAdmin();
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // Shape (1): INSERT INTO audit_log — emitted by withAudit.
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
            `requestVerificationInfo defaultDb: audit_log INSERT failed: ${error.message}`,
          );
        }
        return { rows: [] };
      }

      throw new Error(
        `requestVerificationInfo defaultDb: unsupported SQL shape ` +
          `(this action only issues an audit_log INSERT — no profile reads/writes). ` +
          `Got: ${normalized.slice(0, 120)}`,
      );
    },
  };

  return {
    transaction: async (callback) => callback(txClient),
  };
}
