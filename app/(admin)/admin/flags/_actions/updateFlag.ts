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
 * Production note — `db` injection point mirrors `changeRole.ts`. See
 * that file's header for the supabase-js no-real-tx caveat (ADR-0017).
 *
 * See ADR-0035 §Surface 7 + AC21 / AC22.
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import type { Role } from '@/lib/auth/types';
import { withAudit, type TransactionClient } from '@/lib/audit/withAudit';
import { createAdminClient } from '@/lib/supabase/admin';

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
 * Structural transaction runner — mirrors `changeRole.ts` /
 * `requestReverification.ts`. Tests inject a pglite-backed adapter;
 * production uses the supabase-admin shim.
 */
export interface TransactionRunner {
  transaction<T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T>;
}

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

  const runner = db ?? defaultDb();

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

// ---- Default production adapter -------------------------------------------
//
// Defined BELOW `updateFlag` so the file's first `await` token in source
// order is the `await requireRole('manager')` inside the action. AC5's
// regex-tier defense-in-depth walker scans for the first `\bawait\b` in
// source order; placing the adapter (which contains internal `await`
// calls against the supabase client) above the action would silently fail
// the gate. Function declarations are hoisted so the
// `db ?? defaultDb()` reference resolves correctly despite the textual
// ordering.

/**
 * Production `TransactionRunner` — see `changeRole.ts` §Production note
 * for the supabase-js no-real-tx caveat. This action issues three query
 * shapes:
 *
 *   (1) SELECT enabled, percent, allowlist, role_gate, updated_at, updated_by
 *       FROM feature_flags WHERE key = $1 [FOR UPDATE]
 *   (2) UPDATE feature_flags SET <dynamic set list>, updated_at = now(),
 *       updated_by = $N WHERE key = $M
 *   (3) INSERT INTO audit_log (...)  <- issued by withAudit itself
 *
 * Any other SQL shape throws so the failure mode is loud — see the SAFETY
 * POSTURE note in `changeRole.ts`.
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
    throw new Error(`updateFlag defaultDb: expected string|null param, got ${typeof v}`);
  };
  const asString = (v: unknown): string => {
    if (typeof v === 'string') return v;
    throw new Error(`updateFlag defaultDb: expected string param, got ${typeof v}`);
  };

  const txClient: TransactionClient = {
    async query(sql, params) {
      const adminClient = getAdmin();
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // Shape (1): SELECT ... FROM feature_flags WHERE key = $1 [FOR UPDATE]
      if (
        /^SELECT\s+enabled,\s+percent,\s+allowlist,\s+role_gate,\s+updated_at,\s+updated_by\s+FROM\s+feature_flags\s+WHERE\s+key\s*=\s*\$1/i.test(
          normalized,
        )
      ) {
        const key = asString(params?.[0]);
        const { data, error } = await adminClient
          .from('feature_flags')
          .select('enabled, percent, allowlist, role_gate, updated_at, updated_by')
          .eq('key', key)
          .maybeSingle();
        if (error) {
          throw new Error(`updateFlag defaultDb: SELECT failed: ${error.message}`);
        }
        return { rows: data ? [data] : [] };
      }

      // Shape (2): UPDATE feature_flags SET ... WHERE key = $N
      if (/^UPDATE\s+feature_flags\s+SET\s+/i.test(normalized)) {
        // Parse the dynamic SET list to extract the column updates. The
        // action's SQL builder uses a fixed column-name vocabulary so we
        // can pattern-match each.
        const update: Record<string, unknown> = {};
        const setSection = /SET\s+(.+?)\s+WHERE/i.exec(normalized);
        if (!setSection) {
          throw new Error(`updateFlag defaultDb: UPDATE SET-clause parse failed: ${normalized}`);
        }
        const setItems = setSection[1]!.split(',').map((s) => s.trim());
        // Positional params: [<provided cols in order>, actor_id, key].
        // We rebuild the column list from the normalized SQL. The
        // `updated_at = now()` SET item has no positional param.
        let paramIdx = 0;
        for (const item of setItems) {
          if (/^updated_at\s*=\s*now\(\)/i.test(item)) continue;
          const colMatch = /^(\w+)\s*=\s*\$(\d+)/.exec(item);
          if (!colMatch) {
            throw new Error(`updateFlag defaultDb: SET item parse failed: ${item}`);
          }
          const col = colMatch[1]!;
          update[col] = params?.[paramIdx];
          paramIdx += 1;
        }
        // updated_at — set to a fresh now() ISO string. supabase-js doesn't
        // support the SQL function `now()` via PostgREST; the closest
        // production-fidelity approach is to set the column to a JS-side
        // ISO timestamp. The pglite tests get the SQL-side `now()` (more
        // accurate); production drifts by milliseconds.
        update.updated_at = new Date().toISOString();

        const key = asString(params?.[(params?.length ?? 1) - 1]);
        const { error } = await adminClient
          .from('feature_flags')
          .update(update)
          .eq('key', key);
        if (error) {
          throw new Error(`updateFlag defaultDb: UPDATE failed: ${error.message}`);
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
          throw new Error(`updateFlag defaultDb: audit_log INSERT failed: ${error.message}`);
        }
        return { rows: [] };
      }

      throw new Error(
        `updateFlag defaultDb: unsupported SQL shape ` +
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
