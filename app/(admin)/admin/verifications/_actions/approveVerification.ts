import 'server-only';

/**
 * `approveVerification` — server action that approves a member's ID
 * verification by stamping `id_verified_at` and assigning a permanent
 * `member_number` via the `member_number_seq` sequence (ADR-0035 AC12,
 * WB.T8).
 *
 * Contract (load-bearing — do not weaken):
 *
 *   1. **First runtime statement is `await requireRole('manager');`** —
 *      AC5 first-await defense-in-depth. The admin layout has already
 *      gated the segment; this action re-asserts independently so a
 *      future refactor that detaches it from the layout is caught by
 *      `tests/auth/admin-routes-defense-in-depth.test.ts`.
 *
 *   2. **Self-edit guard** throws `SelfEditViolation` BEFORE the audit
 *      tx opens. No audit row is written for a self-edit attempt; same
 *      reasoning as `changeRole` / `requestReverification` (cleaner
 *      audit posture, no PII to leak — premortem R12).
 *
 *   3. **Idempotent no-op when already verified.** If the pre-image
 *      already has `id_verified_at IS NOT NULL`, the action returns
 *      `{ ok: true, memberNumber: <existing> }` WITHOUT writing an
 *      audit row and WITHOUT consuming a new sequence value. The
 *      idempotency branch fires INSIDE the audit-tx — the `withAudit`
 *      helper writes the audit row from `mutate`'s return value, so a
 *      no-op early-return at that point cleanly skips both the UPDATE
 *      and the audit INSERT. The spec's AC12 recommendation pins this
 *      shape: "idempotent no-op when id_verified_at IS NOT NULL,
 *      return the existing memberNumber."
 *
 *   4. **Sequence-based member_number assignment** (premortem R6
 *      mitigation). The `member_number_seq` sequence is created in
 *      migration 0005 (the `t0` migration for ADR-0035), so the
 *      `nextval('member_number_seq')` call is the default path —
 *      the COALESCE-fallback documented in the spec's narrative is
 *      NOT implemented here because the sequence is guaranteed to
 *      exist by migration ordering. If the sequence is ever dropped,
 *      the UPDATE will fail loudly and the audit-tx will roll back.
 *
 *   5. **Audit `before` / `after` carry ONLY timestamps + member_number —
 *      NO PII.** Per AC28, the cross-cutting
 *      `tests/admin/no-pii-in-admin-audit.test.ts` grep asserts the
 *      absence of `email`, `full_name`, `phone`, `dob` in every admin-
 *      action source file. The action constructs the snapshots as
 *      `{ id_verified_at, member_number }` — those are the only two
 *      columns the audit row references.
 *
 *   6. **Post-tx best-effort `revalidateTag('admin-dashboard-counts')`**
 *      (AC35) — approving a verification removes a row from the
 *      pending-verifications count, so the dashboard reflects the
 *      change without waiting for the 30-second TTL. The call is
 *      wrapped in try/catch so a Next-cache outage cannot
 *      retroactively roll back the audit-tx commit (premortem R2).
 *
 *   7. **Post-tx best-effort welcome-email enqueue (STUB).** ADR-0025
 *      (SMS / email transactional sends) is BLOCKED — the welcome
 *      email cannot ship in v1. The stub records a structured log
 *      line so ops can grep for the "would-have-sent" trail and
 *      backfill once ADR-0025 unblocks. The stub is wrapped in
 *      try/catch for the same R2 reason as the cache invalidation:
 *      a stub-side failure must not roll back the audit-tx commit.
 *
 * Production note — `db` injection point:
 *   - Default `db` uses the supabase service-role admin client wrapped
 *     in a structural `TransactionRunner` adapter (see `defaultDb()`).
 *     Because supabase-js does NOT expose a real Postgres transaction
 *     API as of cycle 3, the production adapter runs the queries
 *     sequentially through the admin client and emits the audit row
 *     via a final `INSERT INTO audit_log`. This is NOT atomic in
 *     production until ADR-0017's server-side pg driver lands. The
 *     pglite-backed tests DO get atomicity (real `pg.transaction()`)
 *     so the spec's `withAudit` invariant is exercised end-to-end in
 *     CI.
 *   - Tests inject a pglite-backed `TransactionRunner` via the `db`
 *     parameter; see `tests/admin/approve-verification-action.test.ts`.
 *   - When ADR-0017 ships, swap `defaultDb()` to return a real
 *     pg-driver-backed adapter — no call-site changes needed.
 *
 * See ADR-0035 §AC12 + premortem R6.
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import { withAudit, type TransactionClient } from '@/lib/audit/withAudit';
import { createAdminClient } from '@/lib/supabase/admin';

import { SelfEditViolation } from '@/app/(admin)/admin/_errors';
import {
  trackAdminEvent,
  readVerificationQueueDepth,
} from '@/lib/analytics/admin-events';

// ---- Public types ---------------------------------------------------------

export interface ApproveVerificationParams {
  profileId: string;
}

export interface ApproveVerificationResult {
  ok: true;
  /**
   * The `member_number` assigned (or already-assigned, on the idempotent
   * no-op path). Sequence-driven values start at 1000 per migration
   * 0005's `CREATE SEQUENCE ... START WITH 1000`.
   */
  memberNumber: number;
}

/**
 * Structural transaction runner — same shape as the pglite
 * `pg.transaction(async (tx) => ...)` callback API. The action wraps
 * the `withAudit` call in `db.transaction(...)` so the SELECT-FOR-UPDATE
 * + UPDATE + audit-INSERT either all commit or all roll back.
 *
 * Tests pass a pglite-backed adapter (real txn semantics). Production
 * uses `defaultDb()` — see file header for the transaction-fidelity
 * caveat.
 */
export interface TransactionRunner {
  transaction<T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T>;
}

// ---- The action ------------------------------------------------------------

/**
 * Approve a member's ID verification. See file header for the full
 * contract. The `db` parameter is for test injection only — production
 * callers MUST omit it so the default service-role adapter is used.
 *
 * @param params.profileId — UUID of the target profile.
 * @param db — optional `TransactionRunner` for test injection. Omit in
 *   production.
 *
 * @throws SelfEditViolation — when `profileId === session.user.id`.
 */
export async function approveVerification(
  params: ApproveVerificationParams,
  db?: TransactionRunner,
): Promise<ApproveVerificationResult> {
  // AC5 first-statement defense-in-depth.
  const { profile: actor } = await requireRole('manager');

  // Self-edit guard (ADR-0035 §Self-edit prevention). Fires BEFORE the
  // audit tx so no row is written for a self-edit attempt — cleaner
  // audit posture, no PII to leak (R12).
  if (params.profileId === actor.id) {
    throw new SelfEditViolation('cannot approve own verification');
  }

  const runner = db ?? defaultDb();

  // Track the assigned member_number for the post-tx return value AND
  // for the idempotent-no-op branch. The closure variable is set
  // either by the audit-tx mutate (mutation path) or by the early
  // pre-read (no-op path) — both flow back to the same return shape.
  let assignedMemberNumber: number | null = null;
  let didMutate = false;

  await runner.transaction(async (tx) =>
    withAudit(
      tx,
      {
        action: 'admin.verification.approved',
        targetType: 'profile',
        targetId: params.profileId,
        actorId: actor.id,
      },
      async (txInner) => {
        // SELECT ... FOR UPDATE locks the row against concurrent
        // approve/reject inside the same tx. The captured `before` is
        // the post-lock value (matches the audit-log invariant that
        // before/after reflect the moment of the change). The row
        // lock also defeats the two-managers-approve-same-profile race
        // documented in premortem R5.
        const beforeRead = await txInner.query(
          'SELECT id_verified_at, member_number FROM profiles WHERE id = $1 FOR UPDATE',
          [params.profileId],
        );
        const beforeRow = beforeRead.rows[0] as
          | { id_verified_at: string | Date | null; member_number: number | string | null }
          | undefined;
        if (!beforeRow) {
          throw new Error(
            `approveVerification: profile not found (id=${params.profileId})`,
          );
        }

        // Idempotent no-op branch — AC12 contract: "idempotent no-op
        // when id_verified_at IS NOT NULL, return the existing
        // memberNumber." We surface this by throwing a sentinel that
        // the outer `runner.transaction` catch translates into a
        // clean early return. Throwing inside `withAudit`'s mutate
        // skips the audit INSERT (per withAudit's no-catch contract)
        // and rolls back the (empty) tx. The sentinel propagates up
        // to be unwrapped after the runner.transaction call.
        //
        // We use a typed sentinel rather than a control-flow return
        // because withAudit requires a `WithAuditMutateResult` shape
        // and there is no "skip the audit INSERT" return path in
        // its API (by design — see lib/audit/withAudit.ts §Forbidden
        // implementation shapes). The throw IS the documented way
        // to bail the audit row.
        if (beforeRow.id_verified_at !== null) {
          assignedMemberNumber = coerceMemberNumber(beforeRow.member_number);
          didMutate = false;
          throw new IdempotentNoOp();
        }

        // Mutation path — UPDATE id_verified_at and consume a sequence
        // value for member_number. The sequence is created in
        // migration 0005 (premortem R6 mitigation); nextval is atomic
        // in Postgres so concurrent approvals of DIFFERENT profiles
        // never collide.
        await txInner.query(
          `UPDATE profiles
              SET id_verified_at = now(),
                  member_number  = nextval('member_number_seq')
            WHERE id = $1`,
          [params.profileId],
        );

        const afterRead = await txInner.query(
          'SELECT id_verified_at, member_number FROM profiles WHERE id = $1',
          [params.profileId],
        );
        const afterRow = afterRead.rows[0] as
          | { id_verified_at: string | Date | null; member_number: number | string | null }
          | undefined;
        if (!afterRow) {
          throw new Error(
            `approveVerification: profile vanished post-update (id=${params.profileId})`,
          );
        }

        // Coerce member_number to number — Postgres returns BIGINT-ish
        // sequence values which some drivers return as strings. Audit
        // rows must be JSON-clean numbers, and the public return shape
        // pins `memberNumber: number`.
        const numericAfter = coerceMemberNumber(afterRow.member_number);
        if (numericAfter === null) {
          throw new Error(
            `approveVerification: member_number missing after UPDATE (id=${params.profileId})`,
          );
        }
        assignedMemberNumber = numericAfter;
        didMutate = true;

        // Coerce timestamps to ISO strings — pglite returns `Date` for
        // timestamptz columns; supabase / PostgREST returns ISO strings.
        // The audit row stores JSON so consistent representation across
        // the two paths keeps assertions stable. TS narrowing via
        // `instanceof Date` requires the LHS to NOT be a primitive, so
        // we round-trip through `unknown` before the check.
        const beforeVerifiedAt: string | null = coerceTimestamp(beforeRow.id_verified_at);
        const afterVerifiedAt: string | null = coerceTimestamp(afterRow.id_verified_at);

        // Audit before/after — ONLY timestamps + member_number. NO PII
        // (AC28). The pre-image carries both nulls (we only reach this
        // branch when id_verified_at was null); the after carries the
        // freshly-stamped values.
        return {
          before: {
            id_verified_at: beforeVerifiedAt,
            member_number: coerceMemberNumber(beforeRow.member_number),
          },
          after: {
            id_verified_at: afterVerifiedAt,
            member_number: numericAfter,
          },
          result: { ok: true as const },
        };
      },
    ),
  ).catch((err: unknown) => {
    // Unwrap the idempotent-no-op sentinel. Any other error propagates
    // — the caller's tx wrapper rolls back and the action re-throws to
    // the page-level error boundary (existing toast pattern).
    if (err instanceof IdempotentNoOp) {
      return;
    }
    throw err;
  });

  if (assignedMemberNumber === null) {
    // Defensive — both branches above set assignedMemberNumber. If we
    // reach this point, the tx callback returned without setting it,
    // which is a programming error.
    throw new Error(
      `approveVerification: internal — memberNumber unset after tx (id=${params.profileId})`,
    );
  }

  // Post-tx best-effort work. BOTH calls are wrapped in try/catch so a
  // failure here cannot retroactively roll back the audit-tx commit
  // (premortem R2). We deliberately do NOT await these in parallel
  // because each is independently best-effort and ordered logging is
  // more useful to ops than micro-optimization.

  // AC35 cache invalidation — pending-verifications count drops by one.
  if (didMutate) {
    try {
      revalidateTag('admin-dashboard-counts');
    } catch (err) {
      console.warn('approveVerification: cache-invalidation-skipped', {
        profileId: params.profileId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Welcome-email stub. ADR-0025 (transactional sends) is blocked at
  // the platform layer; we record a structured "would-have-sent" line
  // so ops can backfill once the integration unblocks. The stub is
  // wired here (not in a dedicated module) because the queue
  // primitive itself is ADR-0025's deliverable — this action does NOT
  // own retry/back-pressure/dedup semantics. When ADR-0025 ships,
  // swap this block for the real `enqueueWelcomeEmail(profileId)`
  // call from the queue module.
  //
  // TODO(adr-0025): replace stub with real enqueue once transactional
  // sends are unblocked. The audit row already records the approval,
  // so a delayed email send remains consistent.
  if (didMutate) {
    try {
      console.info('approveVerification: welcome-email-enqueue-stub', {
        profileId: params.profileId,
        memberNumber: assignedMemberNumber,
        // NOTE: deliberately no PII fields (email, name) — the audit
        // row's PII-redaction contract extends to this log line.
      });
    } catch (err) {
      console.warn('approveVerification: welcome-email-stub-skipped', {
        profileId: params.profileId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ADR-0035 AC31 + premortem R4: emit `admin_action_attempted` AND
  // `admin_verification_decision`. Both payloads carry NO PII (no
  // actor_id, no profile.id, no email) — the helper defensively
  // strips any forbidden keys. The queue-depth read is best-effort
  // (returns 0 on failure). Fire-and-forget; the helper internally
  // swallows errors so telemetry cannot break the action.
  void trackAdminEvent('admin_action_attempted', {
    action: 'approveVerification',
    target_type: 'profile',
    outcome: 'ok',
  });
  void (async () => {
    const queueDepth = await readVerificationQueueDepth();
    await trackAdminEvent('admin_verification_decision', {
      decision: 'approve',
      queue_depth_at_decision: queueDepth,
    });
  })();

  return { ok: true, memberNumber: assignedMemberNumber };
}

// ---- Helpers --------------------------------------------------------------

/**
 * Sentinel error class for the idempotent-no-op branch. NOT exported —
 * it is private control flow between `mutate` and the post-tx unwrap.
 *
 * Extends `Error` (premortem R12 — withAudit swallows non-error throws)
 * so the cross-cutting throw-discipline walker continues to pass.
 */
class IdempotentNoOp extends Error {
  constructor() {
    super('approveVerification: idempotent no-op (already verified)');
    this.name = 'IdempotentNoOp';
  }
}

/**
 * Coerce a Postgres timestamptz value to an ISO string. pglite returns
 * `Date` for timestamptz columns; supabase / PostgREST returns ISO
 * strings. The audit row stores JSON so consistent representation
 * across the two paths keeps assertions stable.
 */
function coerceTimestamp(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') {
    return String(v);
  }
  // Defensive — unknown shape (e.g. driver returns a custom Timestamp
  // object). We refuse rather than emit `[object Object]` into the
  // audit row, which would be silently misleading.
  return null;
}

/**
 * Postgres may return BIGINT-typed sequence values as strings via some
 * drivers (pg) or as numbers via others (pglite, supabase REST). This
 * helper normalises to `number | null` so the public return type and
 * the audit-row shape stay deterministic.
 *
 * Values larger than `Number.MAX_SAFE_INTEGER` (2^53 - 1) are clamped
 * to NaN and rejected — the `member_number_seq` starts at 1000 and
 * increments by 1, so this is purely defensive against a future drift
 * (e.g. a manual `setval` to a precision-losing value).
 */
function coerceMemberNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === 'bigint') {
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(v);
  }
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (n > Number.MAX_SAFE_INTEGER) return null;
    return n;
  }
  return null;
}

// ---- Default production adapter -------------------------------------------
//
// Defined BELOW `approveVerification` so the file's first `await` token
// is the `await requireRole('manager')` inside the action. AC5's regex-
// tier defense-in-depth walker scans for the first `\bawait\b` token in
// source order; placing the adapter (which contains internal `await`
// calls against the supabase client) above the action would silently
// fail the gate. Function declarations are hoisted in JS, so the
// `db ?? defaultDb()` reference in the action resolves correctly
// despite the textual ordering.

/**
 * Construct the production `TransactionRunner` backed by the supabase
 * service-role admin client. See `changeRole.ts` for the full
 * supabase-js no-real-tx caveat — this adapter is the same shape with
 * the four query patterns this action issues:
 *
 *   (1) SELECT id_verified_at, member_number FROM profiles
 *         WHERE id = $1 [FOR UPDATE]
 *   (2) UPDATE profiles SET id_verified_at = now(),
 *         member_number = nextval('member_number_seq') WHERE id = $1
 *   (3) (handled by shape 1 — post-UPDATE SELECT shares the regex)
 *   (4) INSERT INTO audit_log (...)  ← issued by withAudit itself
 *
 * Any other SQL throws so the failure mode is loud — see SAFETY
 * POSTURE in `changeRole.ts`.
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
      `approveVerification defaultDb: expected string|null param, got ${typeof v}`,
    );
  };
  const asString = (v: unknown): string => {
    if (typeof v === 'string') return v;
    throw new Error(`approveVerification defaultDb: expected string param, got ${typeof v}`);
  };

  const txClient: TransactionClient = {
    async query(sql, params) {
      const adminClient = getAdmin();
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // Shapes (1) + (3): SELECT id_verified_at, member_number FROM profiles
      //   WHERE id = $1 [FOR UPDATE]
      if (
        /^SELECT\s+id_verified_at\s*,\s*member_number\s+FROM\s+profiles\s+WHERE\s+id\s*=\s*\$1/i.test(
          normalized,
        )
      ) {
        const id = asString(params?.[0]);
        const { data, error } = await adminClient
          .from('profiles')
          .select('id_verified_at, member_number')
          .eq('id', id)
          .maybeSingle();
        if (error) {
          throw new Error(
            `approveVerification defaultDb: SELECT id_verified_at,member_number failed: ${error.message}`,
          );
        }
        return { rows: data ? [data] : [] };
      }

      // Shape (2): UPDATE profiles SET id_verified_at = now(),
      //   member_number = nextval('member_number_seq') WHERE id = $1
      //
      // PostgREST does NOT support `now()` or `nextval()` as update
      // expression values — the supabase admin client can only POST
      // literal values via `.update()`. We invoke a single RPC instead.
      // If that RPC is not yet provisioned (ADR-0009 / ADR-0017
      // pending), this branch falls back to a read-then-write that
      // is NOT atomic — the pglite tests provide atomicity coverage;
      // production lands real atomicity with the pg driver in
      // ADR-0017.
      if (
        /^UPDATE\s+profiles\s+SET\s+id_verified_at\s*=\s*now\(\)\s*,\s*member_number\s*=\s*nextval\(/i.test(
          normalized,
        )
      ) {
        const id = asString(params?.[0]);
        // Best-effort RPC path. The RPC is owned by ADR-0009's slice
        // 2/3 work; until it ships, we degrade to a read-write pair.
        // The pglite tests exercise the atomic path so this branch
        // is purely the production stub.
        const rpc = adminClient as unknown as {
          rpc: (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<{ data: unknown; error: { message: string } | null }>;
        };
        if (typeof rpc.rpc === 'function') {
          const { error } = await rpc.rpc('approve_verification_assign_number', {
            target_profile_id: id,
          });
          if (!error) {
            return { rows: [] };
          }
          // RPC missing — fall through to the structural fallback so
          // the action still completes (audit row already in flight).
          console.warn('approveVerification defaultDb: RPC unavailable, falling back', {
            error: error.message,
          });
        }

        // Structural fallback — NOT atomic; tests cover the atomic
        // path via the injected pglite runner. The fallback issues
        // a single UPDATE that lets Postgres resolve now() +
        // nextval() server-side; supabase-js's `.update({...})` does
        // not expose raw expressions, but `.rpc(...)` on a SQL
        // execution endpoint would. With neither available, the
        // safest production stub is to short-circuit with a loud
        // error so ops sees the misconfiguration rather than
        // silently writing a stale row.
        throw new Error(
          'approveVerification defaultDb: no atomic UPDATE path available ' +
            '(supabase-js cannot express now() + nextval() in .update(); ' +
            'provision approve_verification_assign_number RPC per ADR-0009 ' +
            'or land ADR-0017 pg driver).',
        );
      }

      // Shape (4): INSERT INTO audit_log — emitted by withAudit.
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
            `approveVerification defaultDb: audit_log INSERT failed: ${error.message}`,
          );
        }
        return { rows: [] };
      }

      throw new Error(
        `approveVerification defaultDb: unsupported SQL shape ` +
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
