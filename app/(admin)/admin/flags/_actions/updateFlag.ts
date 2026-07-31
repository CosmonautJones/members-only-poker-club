import 'server-only';

/**
 * `updateFlag` — server action that mutates a single `feature_flags` row
 * with most-specific-first audit-event selection (ADR-0035 AC22, WC.T16).
 *
 * Contract (load-bearing — do not weaken):
 *
 *   1. **First runtime statement is `await requireRole('manager');`** —
 *      AC5 first-await defense-in-depth.
 *
 *   2. **At least one of `enabled / percent / allowlist / roleGate` must
 *      be present**, else throw `NoChange` BEFORE the audit-tx opens. The
 *      no-op rejection fires WITHOUT writing an audit row — the audit log
 *      carries operational truth, and a no-fields call has no operational
 *      meaning to record.
 *
 *   3. **Most-specific-first audit-event selection.** Exactly ONE audit
 *      row per call; the event verb is chosen by the first matching
 *      mutation kind in this order:
 *        - `enabled` changed       -> `admin.flag.toggled`
 *        - else `percent` changed  -> `admin.flag.percent_changed`
 *        - else `allowlist` changed-> `admin.flag.allowlist_changed`
 *        - else `roleGate` changed -> `admin.flag.role_gate_changed`
 *      An `enabled` + `percent` multi-change yields ONE
 *      `admin.flag.toggled` row (most-specific wins). When none of the
 *      provided fields actually changes against the live row, we still
 *      write the audit row for the highest-priority provided field — the
 *      action's contract is "you said to update X; the audit log records
 *      that X was set, even if to the same value." The `before` / `after`
 *      shape reflects ONLY the provided columns + the structural
 *      `updated_at` / `updated_by` deltas.
 *
 *   4. **`percent ∈ [0, 100]`** is validated at the action layer in
 *      addition to the DB CHECK constraint. A malformed value (negative,
 *      > 100, non-integer) throws `RangeError` BEFORE the audit-tx opens
 *      so no audit row is written for a bad-input attempt.
 *
 *   5. **No PII in `before` / `after`** — only the four mutable columns
 *      plus the structural `updated_at` / `updated_by` deltas appear.
 *      The cross-cutting `tests/admin/no-pii-in-admin-audit.test.ts` grep
 *      (AC28) asserts the absence of PII column names in every admin-
 *      action source file.
 *
 *   6. **Post-tx `revalidateTag('admin-dashboard-counts')`** (AC35) — the
 *      kill-switch toggle changes the active-kill-switch dashboard count;
 *      we invalidate unconditionally for simplicity (the spec accepts the
 *      "non-kill flag invalidates too" inefficiency in trade for a single
 *      code path). Wrapped in try/catch so a Next-cache outage cannot
 *      retroactively roll back the audit-tx commit (premortem R2).
 *
 *   7. **In-memory flag cache invalidation is a TODO.** The cycle-1
 *      `lib/flags/registry.ts` reads from a static in-code registry; no
 *      DB-backed cache exists yet. A future slice will wire `lib/flags/`
 *      to the `feature_flags` table and add a per-key invalidation hook
 *      here. For now we emit a `console.warn` breadcrumb so the pending
 *      hook is discoverable in logs.
 *
 * Production defaults to the shared Postgres transaction runner. Tests
 * inject the same `TransactionRunner` seam with PGlite.
 *
 * See ADR-0035 §Surface 7 + AC21 / AC22.
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import type { Role } from '@/lib/auth/types';
import { withAudit } from '@/lib/audit/withAudit';
import { postgresTransactionRunner } from '@/lib/db/postgres-transaction-runner';
import type { TransactionRunner } from '@/lib/db/transactions';

import { NoChange } from '@/app/(admin)/admin/_errors';
import { trackAdminEvent, type AdminFlagField } from '@/lib/analytics/admin-events';

// ---- Public types ---------------------------------------------------------

export interface UpdateFlagParams {
  key: string;
  enabled?: boolean;
  /** 0..100 inclusive — validated at the action layer + DB CHECK constraint. */
  percent?: number;
  /** Profile UUIDs that always evaluate to enabled regardless of percent. */
  allowlist?: string[];
  /** NULL = no role gate; otherwise only roles >= gate rank evaluate enabled. */
  roleGate?: Role | null;
}

export interface UpdateFlagResult {
  ok: true;
}

/**
 * Shared transaction seam. Tests inject a PGlite-backed runner;
 * production uses the Postgres runner.
 */
export type { TransactionRunner } from '@/lib/db/transactions';

// ---- Audit-event taxonomy (most-specific-first) ---------------------------
//
// The four audit event verbs from ADR-0035 §Audit Event Taxonomy. Listed
// here as named constants so the `tests/admin/audit-event-taxonomy.test.ts`
// (AC27) source-grep can resolve them.
const EVENT_FLAG_TOGGLED = 'admin.flag.toggled';
const EVENT_FLAG_PERCENT_CHANGED = 'admin.flag.percent_changed';
const EVENT_FLAG_ALLOWLIST_CHANGED = 'admin.flag.allowlist_changed';
const EVENT_FLAG_ROLE_GATE_CHANGED = 'admin.flag.role_gate_changed';

// ---- Validation constants ------------------------------------------------

const PERCENT_MIN = 0;
const PERCENT_MAX = 100;

// ---- The action ------------------------------------------------------------

/**
 * Mutate a `feature_flags` row with most-specific-first audit selection.
 * See file header for the full contract.
 *
 * @param params.key — the flag's primary key.
 * @param params.enabled — optional new `enabled` value.
 * @param params.percent — optional new `percent` (0..100).
 * @param params.allowlist — optional new `allowlist` array (replaces).
 * @param params.roleGate — optional new `role_gate` (null = clear).
 * @param db — optional `TransactionRunner` for test injection.
 *
 * @throws NoChange — when no mutable field is provided.
 * @throws RangeError — when `percent` is out of range or non-integer.
 * @throws Error — when the row does not exist (mid-tx).
 */
export async function updateFlag(
  params: UpdateFlagParams,
  db?: TransactionRunner,
): Promise<UpdateFlagResult> {
  // AC5 first-statement defense-in-depth.
  const { profile: actor } = await requireRole('manager');

  // NoChange guard — at least one of the four mutable fields must be
  // present. Fires BEFORE the audit tx so no audit row is written for
  // an empty-input call (cleaner forensic posture — premortem R12).
  const provided = {
    enabled: params.enabled !== undefined,
    percent: params.percent !== undefined,
    allowlist: params.allowlist !== undefined,
    roleGate: params.roleGate !== undefined,
  };
  if (!provided.enabled && !provided.percent && !provided.allowlist && !provided.roleGate) {
    throw new NoChange(
      'updateFlag: at least one of enabled / percent / allowlist / roleGate must be provided',
    );
  }

  // Percent validation — at the action layer in addition to the DB CHECK
  // constraint. Fires BEFORE the audit-tx; no audit row for a bad-input
  // attempt.
  if (provided.percent) {
    const p = params.percent as number;
    if (!Number.isInteger(p) || p < PERCENT_MIN || p > PERCENT_MAX) {
      throw new RangeError(
        `updateFlag: percent must be an integer in [${PERCENT_MIN}, ${PERCENT_MAX}] (got ${p})`,
      );
    }
  }

  const runner = db ?? postgresTransactionRunner;

  // Most-specific-first audit event selection. The verb is decided BEFORE
  // the audit-tx opens (only depends on which fields the caller provided
  // — NOT on whether the values actually differ from the live row). This
  // matches the spec's "the action's contract is what the caller asked to
  // do" framing in AC22.
  let action: string;
  if (provided.enabled) {
    action = EVENT_FLAG_TOGGLED;
  } else if (provided.percent) {
    action = EVENT_FLAG_PERCENT_CHANGED;
  } else if (provided.allowlist) {
    action = EVENT_FLAG_ALLOWLIST_CHANGED;
  } else {
    // provided.roleGate must be true (we guarded against the empty case
    // above).
    action = EVENT_FLAG_ROLE_GATE_CHANGED;
  }

  await runner.transaction(async (tx) =>
    withAudit(
      tx,
      {
        action,
        targetType: 'feature_flag',
        targetId: params.key,
        actorId: actor.id,
      },
      async (txInner) => {
        // SELECT ... FOR UPDATE captures the pre-image and locks the row
        // against concurrent flag-mutations inside the same tx. We read
        // all four mutable columns plus updated_at / updated_by so the
        // before/after delta is complete.
        const beforeRead = await txInner.query(
          'SELECT enabled, percent, allowlist, role_gate, updated_at, updated_by FROM feature_flags WHERE key = $1 FOR UPDATE',
          [params.key],
        );
        const beforeRow = beforeRead.rows[0] as
          | {
              enabled: boolean;
              percent: number;
              allowlist: string[];
              role_gate: string | null;
              updated_at: string;
              updated_by: string | null;
            }
          | undefined;
        if (!beforeRow) {
          throw new Error(`updateFlag: flag not found (key=${params.key})`);
        }

        // Build the SET clause — only provided columns + the structural
        // updated_at / updated_by. We use a positional-param array so the
        // SQL is parameterized end-to-end (no string interpolation of
        // values, only column names).
        const sets: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (provided.enabled) {
          sets.push(`enabled = $${i++}`);
          values.push(params.enabled);
        }
        if (provided.percent) {
          sets.push(`percent = $${i++}`);
          values.push(params.percent);
        }
        if (provided.allowlist) {
          sets.push(`allowlist = $${i++}`);
          values.push(params.allowlist);
        }
        if (provided.roleGate) {
          sets.push(`role_gate = $${i++}`);
          // `null` is a meaningful value here (clears the gate).
          values.push(params.roleGate ?? null);
        }
        sets.push(`updated_at = now()`);
        sets.push(`updated_by = $${i++}`);
        values.push(actor.id);

        // WHERE key = $N (last positional).
        values.push(params.key);
        const sql = `UPDATE feature_flags SET ${sets.join(', ')} WHERE key = $${i}`;
        await txInner.query(sql, values);

        // Re-read post-update so the after delta reflects the locked-in
        // post-image (matches the audit-log invariant that before/after
        // reflect the moment of the change).
        const afterRead = await txInner.query(
          'SELECT enabled, percent, allowlist, role_gate, updated_at, updated_by FROM feature_flags WHERE key = $1',
          [params.key],
        );
        const afterRow = afterRead.rows[0] as
          | {
              enabled: boolean;
              percent: number;
              allowlist: string[];
              role_gate: string | null;
              updated_at: string;
              updated_by: string | null;
            }
          | undefined;
        if (!afterRow) {
          throw new Error(`updateFlag: flag vanished post-update (key=${params.key})`);
        }

        // Build the before/after deltas. Only the provided mutable columns
        // appear plus the structural updated_at / updated_by. NO PII
        // (AC28) — none of these columns is PII.
        type FlagDelta = {
          enabled?: boolean;
          percent?: number;
          allowlist?: string[];
          role_gate?: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        const beforeDelta: FlagDelta = {
          updated_at: beforeRow.updated_at,
          updated_by: beforeRow.updated_by,
        };
        const afterDelta: FlagDelta = {
          updated_at: afterRow.updated_at,
          updated_by: afterRow.updated_by,
        };
        if (provided.enabled) {
          beforeDelta.enabled = beforeRow.enabled;
          afterDelta.enabled = afterRow.enabled;
        }
        if (provided.percent) {
          beforeDelta.percent = beforeRow.percent;
          afterDelta.percent = afterRow.percent;
        }
        if (provided.allowlist) {
          beforeDelta.allowlist = beforeRow.allowlist;
          afterDelta.allowlist = afterRow.allowlist;
        }
        if (provided.roleGate) {
          beforeDelta.role_gate = beforeRow.role_gate;
          afterDelta.role_gate = afterRow.role_gate;
        }

        return {
          before: beforeDelta,
          after: afterDelta,
          result: { ok: true as const },
        };
      },
    ),
  );

  // Post-tx cache invalidation (AC35). The kill-switch toggle changes the
  // active-kill-switch dashboard count; we invalidate unconditionally for
  // simplicity. Wrapped in try/catch so a Next-cache outage cannot
  // retroactively roll back the audit-tx commit (premortem R2).
  try {
    revalidateTag('admin-dashboard-counts');
  } catch (err) {
    console.warn('updateFlag: cache-invalidation-skipped', {
      key: params.key,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // TODO(slice-future): wire lib/flags/registry.ts in-memory cache
  // invalidation here once the lib reads from the DB-backed feature_flags
  // table. Today the registry is a static in-code map, so this is a no-op
  // breadcrumb. See ADR-0020 + ADR-0035 §AC22 — when the registry moves
  // to a DB-backed read path, this is the per-key cache-bust hook that
  // keeps server-rendered flag evaluations consistent within seconds of
  // an admin write.
  console.warn('updateFlag: in-memory-flag-cache-invalidation-pending', {
    key: params.key,
    note: 'lib/flags/registry.ts is in-code today; DB-backed cache hook is a future slice.',
  });

  // ADR-0035 AC31 + premortem R4: emit `admin_flag_changed` AFTER the
  // audit-tx commits + the cache invalidation runs. The field maps to
  // which most-specific-first column was provided. Payload carries NO
  // PII (the flag key is operational metadata, not member data). Fire-
  // and-forget; the helper internally strips forbidden keys AND swallows
  // errors so a telemetry outage cannot break the action.
  const field: AdminFlagField = provided.enabled
    ? 'enabled'
    : provided.percent
      ? 'percent'
      : provided.allowlist
        ? 'allowlist'
        : 'role_gate';
  void trackAdminEvent('admin_flag_changed', {
    flag_key: params.key,
    field,
  });

  return { ok: true };
}
