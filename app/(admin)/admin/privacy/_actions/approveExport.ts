import 'server-only';

/**
 * `approveExport` — server action that approves a member's data-export
 * request, transitioning the `privacy_requests` row through
 * `pending → in_progress → completed` while emitting a single audit
 * event on the FIRST transition only (ADR-0035 AC24, WC.T17).
 *
 * Two-phase transition (load-bearing — premortem R2 mitigation):
 *
 *   Phase 1 (inside audit-tx):
 *     SELECT FOR UPDATE; assert kind='export' AND status='pending'
 *     (else RequestNotPending); UPDATE status='in_progress'; audit row
 *     committed atomically with the status change.
 *
 *   Phase 2 (post-tx, NOT inside the audit-tx):
 *     Generate the signed export URL via supabase Storage; second
 *     transaction UPDATEs status='completed', resolved_at=now(),
 *     export_url=$url. If the signed-URL generation fails, the row is
 *     moved to status='failed' and a SEPARATE audit event
 *     `admin.privacy.export_url_generation_failed` is emitted. No
 *     attempt is made to roll back the phase-1 audit row (premortem R2:
 *     audit-tx commits are forever; post-tx failures emit their own
 *     forensic breadcrumb).
 *
 * Contract (load-bearing — do not weaken):
 *
 *   1. **First runtime statement is `await requireRole('manager');`** —
 *      AC5 first-await defense-in-depth.
 *
 *   2. **Single audit event on first transition.** The audit row is
 *      written by `withAudit('admin.privacy.export_approved', ...)`
 *      DURING phase 1. Phase 2's status='completed' UPDATE does NOT
 *      write a second audit row — the spec pins "audit row fires only
 *      once (on the pending→in_progress transition)" per AC24.
 *
 *   3. **Re-approval is idempotent-throw.** Calling `approveExport` on
 *      a row whose status is no longer 'pending' (already in_progress,
 *      completed, rejected, or failed) throws `RequestNotPending`. The
 *      throw fires INSIDE the audit-tx, so `withAudit` propagates the
 *      error and the caller's tx wrapper rolls back — NO audit row is
 *      written for a rejected attempt.
 *
 *   4. **Audit before/after carry ONLY status — NO PII.** Per AC28, the
 *      cross-cutting `tests/admin/no-pii-in-admin-audit.test.ts` grep
 *      asserts the absence of `email`, `full_name`, `phone`, `dob` in
 *      every admin-action source file. The action constructs the
 *      snapshots as `{ status: 'pending' }` / `{ status: 'in_progress' }`.
 *
 *   5. **Post-tx `revalidateTag('admin-dashboard-counts')`** (AC35).
 *      Approving an export removes a row from the pending-privacy
 *      count. Wrapped in try/catch so a Next-cache outage cannot
 *      retroactively roll back the audit-tx commit (premortem R2).
 *
 *   6. **Post-tx email stub (ADR-0025 blocked).** The email-the-link
 *      step records a structured `console.info` line so ops can grep
 *      for the "would-have-sent" trail and backfill once ADR-0025
 *      unblocks. The stub is wrapped in try/catch for the same R2
 *      reason as the cache invalidation.
 *
 * Production note — `db` injection point:
 *   - Default `db` uses the supabase service-role admin client wrapped
 *     in a structural `TransactionRunner` adapter (see `defaultDb()`).
 *     Because supabase-js does NOT expose a real Postgres transaction
 *     API as of cycle 3, the production adapter runs the queries
 *     sequentially through the admin client and emits the audit row
 *     via a final `INSERT INTO audit_log`. This is NOT atomic in
 *     production until ADR-0017's server-side pg driver lands. The
 *     pglite-backed tests DO get atomicity (real `pg.transaction()`).
 *   - The `storage` parameter is a separate injection seam for the
 *     signed-URL generation step. Tests inject a stub; production
 *     uses `createAdminClient().storage`.
 *
 * See ADR-0035 §AC24 + premortem R2.
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import { withAudit, type TransactionClient } from '@/lib/audit/withAudit';
import { createAdminClient } from '@/lib/supabase/admin';
import { trackAdminEvent } from '@/lib/analytics/admin-events';
import { nowUtc } from '@/lib/time';

import { RequestNotPending } from '@/app/(admin)/admin/_errors';

// ---- Public types ---------------------------------------------------------

export interface ApproveExportParams {
  requestId: string;
}

export interface ApproveExportResult {
  ok: true;
  /**
   * ISO timestamp 24 hours from approval — when the signed URL expires.
   * Per ADR-0023 the export-URL TTL is 24h (`expiresIn: 86400`).
   */
  expiresAt: string;
}

/**
 * Structural transaction runner — same shape as the pglite
 * `pg.transaction(async (tx) => ...)` callback API.
 */
export interface TransactionRunner {
  transaction<T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T>;
}

/**
 * Structural storage-signing adapter — abstracts the supabase Storage
 * `from(bucket).createSignedUrl(path, expiresIn)` shape so tests can
 * inject a stub that controls the success / failure path.
 */
export interface ExportStorage {
  signExportUrl(path: string, expiresInSeconds: number): Promise<{ signedUrl: string }>;
}

// ---- Constants ------------------------------------------------------------

const EXPORTS_BUCKET = 'privacy-exports';
const EXPORT_URL_TTL_SECONDS = 86400; // 24 hours per ADR-0023.

// ---- The action ------------------------------------------------------------

/**
 * Approve a pending data-export request. See file header for the full
 * contract.
 *
 * @param params.requestId — UUID of the `privacy_requests` row.
 * @param db — optional `TransactionRunner` for test injection.
 * @param storage — optional `ExportStorage` adapter for test injection.
 *
 * @throws RequestNotPending — when the row's `kind` is not `'export'`
 *   OR its `status` is not `'pending'`.
 */
export async function approveExport(
  params: ApproveExportParams,
  db?: TransactionRunner,
  storage?: ExportStorage,
): Promise<ApproveExportResult> {
  // AC5 first-statement defense-in-depth.
  const { profile: actor } = await requireRole('manager');

  const runner = db ?? defaultDb();
  const sign = storage ?? defaultStorage();

  // Phase 1 — atomic status transition pending → in_progress + audit row.
  // The SELECT FOR UPDATE locks the row against concurrent transitions.
  // The kind/status assertion throws RequestNotPending INSIDE the audit-
  // tx so withAudit's "any throw rolls back" contract elides the audit
  // INSERT — a rejected attempt writes no audit row.
  //
  // Wrapped in a mutable holder so TS doesn't narrow to `never` after
  // the closure assignment (same idiom as `captured` in approveDeletion).
  const phase1: { profileId: string | null } = { profileId: null };
  await runner.transaction(async (tx) =>
    withAudit(
      tx,
      {
        action: 'admin.privacy.export_approved',
        targetType: 'privacy_request',
        targetId: params.requestId,
        actorId: actor.id,
      },
      async (txInner) => {
        const beforeRead = await txInner.query(
          'SELECT profile_id, kind, status FROM privacy_requests WHERE id = $1 FOR UPDATE',
          [params.requestId],
        );
        const beforeRow = beforeRead.rows[0] as
          | { profile_id: string; kind: string; status: string }
          | undefined;
        if (!beforeRow) {
          throw new RequestNotPending(`approveExport: request not found (id=${params.requestId})`);
        }
        if (beforeRow.kind !== 'export') {
          throw new RequestNotPending(
            `approveExport: request kind is not 'export' (got ${beforeRow.kind})`,
          );
        }
        if (beforeRow.status !== 'pending') {
          throw new RequestNotPending(
            `approveExport: request status is not 'pending' (got ${beforeRow.status})`,
          );
        }
        phase1.profileId = beforeRow.profile_id;

        await txInner.query(
          `UPDATE privacy_requests
              SET status = 'in_progress',
                  resolved_by = $2
            WHERE id = $1`,
          [params.requestId, actor.id],
        );

        // Audit row — ONLY status — NO PII (AC28).
        return {
          before: { status: 'pending' },
          after: { status: 'in_progress' },
          result: { ok: true as const },
        };
      },
    ),
  );

  // Phase 2 — post-tx signed-URL generation + status='completed' (or
  // 'failed' on URL-generation failure). NOT in the audit-tx — premortem
  // R2 wraps each post-tx side-effect in its own try/catch so a phase-2
  // failure can emit its own forensic event without rolling back phase 1.

  const exportPath = phase1.profileId
    ? `${phase1.profileId}/${params.requestId}.json`
    : `${params.requestId}.json`;
  const expiresAt = new Date(nowUtc().getTime() + EXPORT_URL_TTL_SECONDS * 1000).toISOString();

  let signedUrl: string | null = null;
  let signFailure: string | null = null;
  try {
    const signed = await sign.signExportUrl(exportPath, EXPORT_URL_TTL_SECONDS);
    signedUrl = signed.signedUrl;
  } catch (err) {
    signFailure = err instanceof Error ? err.message : String(err);
  }

  if (signedUrl !== null) {
    // Happy path — second transaction stamps status='completed'.
    try {
      await runner.transaction(async (tx) => {
        await tx.query(
          `UPDATE privacy_requests
              SET status = 'completed',
                  resolved_at = now(),
                  export_url = $2
            WHERE id = $1`,
          [params.requestId, signedUrl],
        );
        return undefined;
      });
    } catch (err) {
      // Post-tx stamp failed — log and proceed. The forensic posture
      // here is "the audit-tx commit is the load-bearing record; this
      // second UPDATE is best-effort." Ops can backfill via the
      // service-role escape hatch if the row stays in 'in_progress'.
      console.warn('approveExport: completion-stamp-skipped', {
        requestId: params.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Email stub (ADR-0025 blocked). Records the intent.
    try {
      console.info('approveExport: export-email-enqueue-stub', {
        requestId: params.requestId,
        // The signedUrl + requester_email are intentionally NOT
        // included in this breadcrumb — no PII in operational logs.
      });
    } catch (err) {
      console.warn('approveExport: email-stub-skipped', {
        requestId: params.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    // Premortem R2 failure path — signed-URL generation rejected. We
    // emit a separate audit event AND flip the row to status='failed'
    // so ops can see the forensic trail without losing the original
    // approval breadcrumb. The failure event is its OWN audit-tx so a
    // failure here cannot retroactively roll back phase 1.
    try {
      await runner.transaction(async (tx) =>
        withAudit(
          tx,
          {
            action: 'admin.privacy.export_url_generation_failed',
            targetType: 'privacy_request',
            targetId: params.requestId,
            actorId: actor.id,
          },
          async (txInner) => {
            await txInner.query(
              `UPDATE privacy_requests
                  SET status = 'failed',
                      reject_reason = $2
                WHERE id = $1`,
              [params.requestId, `signed-url-failed: ${signFailure ?? 'unknown'}`],
            );
            return {
              before: { status: 'in_progress' },
              after: { status: 'failed' },
              result: { ok: true as const },
            };
          },
        ),
      );
    } catch (err) {
      // Truly best-effort — if even the failure-audit fails, we log
      // loudly so ops sees the misconfiguration.
      console.error('approveExport: failure-audit-skipped', {
        requestId: params.requestId,
        original_error: signFailure,
        secondary_error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // AC35 cache invalidation — pending-privacy count drops by one.
  // Wrapped in try/catch so a Next-cache outage cannot retroactively
  // roll back the audit-tx commit (premortem R2).
  try {
    revalidateTag('admin-dashboard-counts');
  } catch (err) {
    console.warn('approveExport: cache-invalidation-skipped', {
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
    action: 'approveExport',
    target_type: 'privacy_request',
    outcome: 'ok',
  });

  return { ok: true, expiresAt };
}

// ---- Default production adapters -----------------------------------------
//
// Defined BELOW `approveExport` so the file's first `await` token is
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
    throw new Error(`approveExport defaultDb: expected string|null param, got ${typeof v}`);
  };
  const asString = (v: unknown): string => {
    if (typeof v === 'string') return v;
    throw new Error(`approveExport defaultDb: expected string param, got ${typeof v}`);
  };

  const txClient: TransactionClient = {
    async query(sql, params) {
      const adminClient = getAdmin();
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // SELECT profile_id, kind, status FROM privacy_requests WHERE id = $1 [FOR UPDATE]
      if (
        /^SELECT\s+profile_id\s*,\s*kind\s*,\s*status\s+FROM\s+privacy_requests\s+WHERE\s+id\s*=\s*\$1/i.test(
          normalized,
        )
      ) {
        const id = asString(params?.[0]);
        const { data, error } = await adminClient
          .from('privacy_requests')
          .select('profile_id, kind, status')
          .eq('id', id)
          .maybeSingle();
        if (error) {
          throw new Error(
            `approveExport defaultDb: SELECT privacy_requests failed: ${error.message}`,
          );
        }
        return { rows: data ? [data] : [] };
      }

      // UPDATE privacy_requests SET status = 'in_progress', resolved_by = $2 WHERE id = $1
      if (/^UPDATE\s+privacy_requests\s+SET\s+status\s*=\s*'in_progress'/i.test(normalized)) {
        const id = asString(params?.[0]);
        const resolvedBy = asStringOrNull(params?.[1]);
        const { error } = await adminClient
          .from('privacy_requests')
          .update({ status: 'in_progress', resolved_by: resolvedBy })
          .eq('id', id);
        if (error) {
          throw new Error(`approveExport defaultDb: UPDATE in_progress failed: ${error.message}`);
        }
        return { rows: [] };
      }

      // UPDATE privacy_requests SET status='completed', resolved_at=now(), export_url=$2 WHERE id = $1
      if (/^UPDATE\s+privacy_requests\s+SET\s+status\s*=\s*'completed'/i.test(normalized)) {
        const id = asString(params?.[0]);
        const url = asString(params?.[1]);
        const { error } = await adminClient
          .from('privacy_requests')
          .update({
            status: 'completed',
            resolved_at: nowUtc().toISOString(),
            export_url: url,
          })
          .eq('id', id);
        if (error) {
          throw new Error(`approveExport defaultDb: UPDATE completed failed: ${error.message}`);
        }
        return { rows: [] };
      }

      // UPDATE privacy_requests SET status='failed', reject_reason=$2 WHERE id = $1
      if (/^UPDATE\s+privacy_requests\s+SET\s+status\s*=\s*'failed'/i.test(normalized)) {
        const id = asString(params?.[0]);
        const reason = asString(params?.[1]);
        const { error } = await adminClient
          .from('privacy_requests')
          .update({ status: 'failed', reject_reason: reason })
          .eq('id', id);
        if (error) {
          throw new Error(`approveExport defaultDb: UPDATE failed failed: ${error.message}`);
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
          throw new Error(`approveExport defaultDb: audit_log INSERT failed: ${error.message}`);
        }
        return { rows: [] };
      }

      throw new Error(
        `approveExport defaultDb: unsupported SQL shape ` +
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

function defaultStorage(): ExportStorage {
  let admin: ReturnType<typeof createAdminClient> | null = null;
  const getAdmin = () => {
    if (admin === null) admin = createAdminClient();
    return admin;
  };

  return {
    async signExportUrl(path, expiresInSeconds) {
      const { data, error } = await getAdmin()
        .storage.from(EXPORTS_BUCKET)
        .createSignedUrl(path, expiresInSeconds);
      if (error || !data?.signedUrl) {
        throw new Error(
          `approveExport defaultStorage: createSignedUrl failed: ${error?.message ?? 'no signed URL returned'}`,
        );
      }
      return { signedUrl: data.signedUrl };
    },
  };
}
