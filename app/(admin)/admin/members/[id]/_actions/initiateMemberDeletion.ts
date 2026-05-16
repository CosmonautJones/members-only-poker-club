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
 * Production note — `db` injection point:
 *   - Same `db` injection pattern as `changeRole.ts` / `openRefundFlow.ts`.
 *     See `changeRole.ts` header for the supabase-js no-real-tx caveat
 *     and ADR-0017 swap-in plan.
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import { withAudit, type TransactionClient } from '@/lib/audit/withAudit';
import { createAdminClient } from '@/lib/supabase/admin';
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

  const runner = db ?? defaultDb();

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

// ---- Default production adapter -------------------------------------------
//
// Defined BELOW `initiateMemberDeletion` so the file's first `await`
// token is the `await requireRole('manager')` inside the action. AC5's
// regex-tier defense-in-depth walker scans for the first `\bawait\b` in
// source order; placing the adapter (which contains internal `await`
// calls against the supabase client) above the action would silently
// fail the gate. Function declarations are hoisted, so the
// `db ?? defaultDb()` reference resolves correctly despite the textual
// ordering.

/**
 * Production `TransactionRunner` — see `changeRole.ts` §Production note
 * for the supabase-js no-real-tx caveat. This action issues three query
 * shapes:
 *
 *   (1) SELECT id, email FROM profiles WHERE id = $1 FOR UPDATE
 *   (2) INSERT INTO privacy_requests (...) VALUES (...) RETURNING id
 *   (3) INSERT INTO audit_log (...)            ← issued by withAudit itself
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

  const asStringOrNull = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    throw new Error(
      `initiateMemberDeletion defaultDb: expected string|null param, got ${typeof v}`,
    );
  };
  const asString = (v: unknown): string => {
    if (typeof v === 'string') return v;
    throw new Error(`initiateMemberDeletion defaultDb: expected string param, got ${typeof v}`);
  };

  const txClient: TransactionClient = {
    async query(sql, params) {
      const adminClient = getAdmin();
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // Shape (1): SELECT id, email FROM profiles WHERE id = $1 [FOR UPDATE]
      if (/^SELECT\s+id,\s*email\s+FROM\s+profiles\s+WHERE\s+id\s*=\s*\$1/i.test(normalized)) {
        const id = asString(params?.[0]);
        const { data, error } = await adminClient
          .from('profiles')
          .select('id, email')
          .eq('id', id)
          .maybeSingle();
        if (error) {
          throw new Error(
            `initiateMemberDeletion defaultDb: SELECT id, email failed: ${error.message}`,
          );
        }
        return { rows: data ? [data] : [] };
      }

      // Shape (2): INSERT INTO privacy_requests (...) RETURNING id
      if (/^INSERT\s+INTO\s+privacy_requests\s*\(/i.test(normalized)) {
        const row = {
          profile_id: asString(params?.[0]),
          requester_email: asString(params?.[1]),
          kind: asString(params?.[2]),
          status: asString(params?.[3]),
          // submitted_at uses now() default at the DB layer
          resolved_by: null,
        };
        const { data, error } = await adminClient
          .from('privacy_requests')
          .insert(row)
          .select('id')
          .single();
        if (error) {
          throw new Error(
            `initiateMemberDeletion defaultDb: INSERT privacy_requests failed: ${error.message}`,
          );
        }
        // PostgREST returns `unknown` for the `.select('id').single()`
        // shape without a typed schema; narrow to the canonical id-only
        // row type at the boundary so the @typescript-eslint/no-unsafe-
        // assignment guard is satisfied AND a future schema-typed
        // supabase client still gets a useful narrowing site.
        const inserted = data as { id: string } | null;
        return { rows: inserted ? [{ id: inserted.id }] : [] };
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
        const auditRow = {
          actor_id: asStringOrNull(params?.[0]),
          action: asString(params?.[1]),
          target_type: asString(params?.[2]),
          target_id: asString(params?.[3]),
          before: parseJson(params?.[4]),
          after: parseJson(params?.[5]),
          ip: asStringOrNull(params?.[6]),
          user_agent: asStringOrNull(params?.[7]),
        };
        const { error } = await adminClient.from('audit_log').insert(auditRow);
        if (error) {
          throw new Error(
            `initiateMemberDeletion defaultDb: audit_log INSERT failed: ${error.message}`,
          );
        }
        return { rows: [] };
      }

      throw new Error(
        `initiateMemberDeletion defaultDb: unsupported SQL shape ` +
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
