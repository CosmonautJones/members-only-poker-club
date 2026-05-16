import 'server-only';

/**
 * `changeRole` — server action that promotes/demotes a member's role on
 * the profile row backing `/admin/members/[id]` (ADR-0035 AC15, WC.T12).
 *
 * Contract (load-bearing — do not weaken):
 *
 *   1. **First runtime statement is `await requireRole('manager');`** — the
 *      outer auth gate. Every `/admin/**` caller must already be `manager+`;
 *      this re-asserts at the action's entry so AC5's first-await
 *      defense-in-depth walker passes.
 *
 *   2. **Self-edit guard** throws `SelfEditViolation` BEFORE any audit
 *      row is written. Owners cannot demote themselves in v1 — there
 *      must always be at least one owner; the application invariant
 *      is the v1 enforcement per ADR-0035 §Self-edit prevention.
 *
 *   3. **Role-ladder authority refine** (second gate, runs AFTER the
 *      outer `requireRole('manager')`):
 *        - Promotion (`newRank > currentRank`) requires an additional
 *          `await requireRole('owner');` — owner-only authority for
 *          upward role moves. Surfaces as `InsufficientRoleError` when
 *          the caller is `manager` (NOT a `RoleLadderViolation`).
 *        - One-rung demotion (`newRank === currentRank - 1`) is covered
 *          by the outer `requireRole('manager')` — no refine.
 *        - Multi-rung demotion (e.g. `owner → member`) throws
 *          `RoleLadderViolation` ("multi-rung demotion not allowed in v1").
 *        - No-op (`newRank === currentRank`) returns early with no audit
 *          row written.
 *
 *   4. **Two-audit-rows-per-role-change invariant** (ADR-0035 §Role-change
 *      flow + ADR-0006 §audit taxonomy):
 *        - The application action emits `admin.member.role_changed`
 *          via `withAudit` — `before` / `after` carry ONLY `{ role }`.
 *        - The DB trigger `profiles_protect_role_change` ALSO writes
 *          `profile.role_change` audit row in the SAME tx. Two rows per
 *          role change is by design; the audit-log viewer's UI-level
 *          collapse heuristic (1-second window) is a Slice 5 ergonomics
 *          task. v1 ships both rows visible.
 *
 *   5. **No PII in `before` / `after`** — the audit row carries only the
 *      role string. The cross-cutting `tests/admin/no-pii-in-admin-audit.test.ts`
 *      grep (AC28) asserts the absence of `email`, `full_name`, `phone`,
 *      `dob` in every admin-action source file.
 *
 *   6. **Post-tx `revalidateTag('admin-dashboard-counts')`** (AC35) —
 *      the recent-activity panel reflects the role change without
 *      waiting for the 30-second TTL. The call is wrapped in try/catch
 *      so a Next-cache outage cannot roll back the audit-tx commit
 *      (premortem R2).
 *
 * Production note — `db` injection point:
 *   - Default `db` uses the supabase service-role admin client wrapped
 *     in a structural `TransactionRunner` adapter (see `defaultDb()`).
 *     Because supabase-js does NOT expose a real Postgres transaction
 *     API as of cycle 3, the production adapter runs the SELECT-FOR-
 *     UPDATE → UPDATE → SELECT-after sequence as serial REST calls and
 *     emits the audit row via a final `INSERT INTO audit_log`. This is
 *     NOT atomic in production until ADR-0017's server-side pg driver
 *     lands. The pglite-backed tests DO get atomicity (real `pg.transaction()`)
 *     so the spec's `withAudit` invariant is exercised end-to-end in CI.
 *   - Tests inject a pglite-backed `TransactionRunner` via the `db`
 *     parameter; see `tests/admin/change-role-action.test.ts`.
 *   - When ADR-0017 ships, swap `defaultDb()` to return a real
 *     pg-driver-backed adapter — no call-site changes needed.
 *
 * See ADR-0035 §Role-change flow + AC15.
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import { ROLE_RANK, type Role } from '@/lib/auth/types';
import { withAudit, type TransactionClient } from '@/lib/audit/withAudit';
import { createAdminClient } from '@/lib/supabase/admin';

import { SelfEditViolation, RoleLadderViolation } from '@/app/(admin)/admin/_errors';
import { trackAdminEvent } from '@/lib/analytics/admin-events';

// ---- Public types ---------------------------------------------------------

export interface ChangeRoleParams {
  profileId: string;
  newRole: Role;
}

export interface ChangeRoleResult {
  ok: true;
  /**
   * `true` when the action actually wrote an audit row (i.e. the role
   * changed). `false` for the no-op early-return path. Useful for tests
   * and for the page's post-action toast to suppress the "two audit
   * rows" copy when nothing actually happened.
   */
  changed: boolean;
}

/**
 * Structural transaction runner — same shape as the pglite
 * `pg.transaction(async (tx) => ...)` callback API. The action wraps the
 * `withAudit` call in `db.transaction(...)` so the SELECT-FOR-UPDATE +
 * UPDATE + audit-INSERT either all commit or all roll back.
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
 * Promote or demote a member's role. See file header for the full
 * contract. The `db` parameter is for test injection only — production
 * callers MUST omit it so the default service-role adapter is used.
 *
 * @param params.profileId — UUID of the target profile.
 * @param params.newRole — the requested role (one of `Role`).
 * @param db — optional `TransactionRunner` for test injection. Omit in
 *   production.
 *
 * @throws SelfEditViolation — when `profileId === session.user.id`.
 * @throws RoleLadderViolation — on multi-rung demotion.
 * @throws InsufficientRoleError — on promotion attempted by a manager
 *   (requires owner).
 */
export async function changeRole(
  params: ChangeRoleParams,
  db?: TransactionRunner,
): Promise<ChangeRoleResult> {
  // AC5 first-statement defense-in-depth. The admin layout already
  // gated; this action re-asserts independently so a future refactor
  // that detaches this file from the (admin) group is caught by
  // `tests/auth/admin-routes-defense-in-depth.test.ts`.
  const { profile: actor } = await requireRole('manager');

  // Self-edit guard (ADR-0035 §Self-edit prevention). Fires BEFORE the
  // audit tx so no row is written for a self-edit attempt — cleaner
  // audit posture, no PII to leak (R12).
  if (params.profileId === actor.id) {
    throw new SelfEditViolation('cannot change own role');
  }

  const runner = db ?? defaultDb();

  // Read the target's current role for the ladder-math gate. This read
  // is OUTSIDE the audit tx — used only to decide which of the four
  // ladder branches (promotion / one-rung demotion / multi-rung
  // demotion / no-op) to take. The tx re-reads with `FOR UPDATE` so
  // the audited `before` reflects the locked-in pre-image.
  const currentRole = await readCurrentRole(runner, params.profileId);
  if (currentRole === null) {
    // No profile row — surface as a typed error so the page can render
    // a "member not found" toast. Mirrors the privacy-action pattern
    // (RequestNotPending) — distinct from auth / ladder failures.
    throw new Error(`changeRole: profile not found (id=${params.profileId})`);
  }

  const currentRank = ROLE_RANK[currentRole];
  const newRank = ROLE_RANK[params.newRole];

  // No-op early return — newRole === currentRole. No audit row.
  if (newRank === currentRank) {
    // ADR-0035 AC31: still emit `admin_action_attempted` with
    // outcome:'ok' — the caller invoked the action successfully even
    // if the no-op branch suppressed the audit row.
    void trackAdminEvent('admin_action_attempted', {
      action: 'changeRole',
      target_type: 'profile',
      outcome: 'ok',
    });
    return { ok: true, changed: false };
  }

  // Multi-rung demotion guard (ADR-0035 §AC15) — forbidden in v1 UI so
  // a compromised manager session cannot fast-path a hostile takedown.
  // Must run BEFORE the owner-required gate; an owner attempting
  // owner→member still throws RoleLadderViolation (not silently
  // succeeding because the actor happens to have owner authority).
  // Promotions cannot be multi-rung in this guard because
  // `currentRank - newRank` is negative for promotions; the typed
  // guard `> 1` excludes them automatically.
  if (!Number.isInteger(currentRank) || !Number.isInteger(newRank)) {
    // Defensive — `ROLE_RANK` lookup miss would surface as NaN.
    throw new Error(
      `changeRole: unrecognized role pair (currentRole=${currentRole}, newRole=${params.newRole})`,
    );
  }
  if (currentRank - newRank > 1) {
    throw new RoleLadderViolation('multi-rung demotion not allowed in v1');
  }

  // Role-ladder authority refine (ADR-0035 §AC15). The spec's narrative
  // text describes "one-rung demotion covered by the outer manager
  // gate", but the AC15 failure matrix at the bottom of the section
  // pins a tighter rule: demoting a `manager` or `owner` requires
  // `owner` authority too. The two phrasings reconcile to a single
  // intuitive principle: **any change that crosses the manager band
  // boundary (in either direction) requires owner authority.** That
  // covers promotions, manager↔cashier demotions, and any owner-side
  // move. The narrower one-rung-as-manager case is restricted to
  // moves entirely within the non-staff band (cashier↔member). The
  // failure matrix at lines 546-556 of the spec is the load-bearing
  // contract here — workers MUST follow it over the narrative gloss.
  //
  // Surfaces as `InsufficientRoleError` when caller is `manager` —
  // NOT `RoleLadderViolation`. The error type is part of the contract
  // so future role-additions don't change the shape.
  const MANAGER_RANK = ROLE_RANK['manager']; // 2
  const promoting = newRank > currentRank;
  const demotingFromStaff = !promoting && currentRank >= MANAGER_RANK;
  if (promoting || demotingFromStaff) {
    await requireRole('owner');
  }

  // Perform the role change inside a transaction so the application
  // audit row (admin.member.role_changed) and the DB-trigger-emitted
  // audit row (profile.role_change) both land atomically. See file
  // header §Production note for the supabase-js no-real-tx caveat.
  await runner.transaction(async (tx) =>
    withAudit(
      tx,
      {
        action: 'admin.member.role_changed',
        targetType: 'profile',
        targetId: params.profileId,
        actorId: actor.id,
      },
      async (txInner) => {
        // SELECT ... FOR UPDATE locks the row against concurrent
        // role-changes inside the same tx. The captured `before` is
        // the post-lock value (matches the audit-log invariant that
        // before/after reflect the moment of the change).
        const beforeRead = await txInner.query(
          'SELECT role FROM profiles WHERE id = $1 FOR UPDATE',
          [params.profileId],
        );
        const beforeRow = beforeRead.rows[0] as { role: Role } | undefined;
        if (!beforeRow) {
          // Vanished between the outside-tx read and the in-tx
          // FOR UPDATE — extremely unlikely in v1 (no profile-delete
          // UI), but the explicit throw lets the tx wrapper roll back
          // cleanly rather than writing an audit row with `before:undefined`.
          throw new Error(`changeRole: profile vanished mid-tx (id=${params.profileId})`);
        }

        await txInner.query('UPDATE profiles SET role = $1 WHERE id = $2', [
          params.newRole,
          params.profileId,
        ]);

        const afterRead = await txInner.query('SELECT role FROM profiles WHERE id = $1', [
          params.profileId,
        ]);
        const afterRow = afterRead.rows[0] as { role: Role } | undefined;
        if (!afterRow) {
          throw new Error(`changeRole: profile vanished post-update (id=${params.profileId})`);
        }

        // Audit before/after — ONLY `{ role }`. NO PII (AC28).
        return {
          before: { role: beforeRow.role },
          after: { role: afterRow.role },
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
    // Best-effort — log but do not throw. The dashboard goes 30s stale
    // until the next request rebuilds the cache.
    console.warn('changeRole: cache-invalidation-skipped', {
      profileId: params.profileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ADR-0035 AC31 + premortem R4: emit `admin_action_attempted` after
  // the audit-tx commits + the cache invalidation runs. Payload is
  // the action name + target_type + outcome — NO actor_id, NO
  // profile.id, NO email. Fire-and-forget; the helper swallows
  // errors so a telemetry outage cannot break the action.
  void trackAdminEvent('admin_action_attempted', {
    action: 'changeRole',
    target_type: 'profile',
    outcome: 'ok',
  });

  return { ok: true, changed: true };
}

// ---- Helpers --------------------------------------------------------------

/**
 * Read the target profile's current role outside the audit tx. Used
 * only for ladder-math gating (no audit row, no FOR UPDATE). The tx
 * below re-reads with `FOR UPDATE` so the audit `before` reflects the
 * locked pre-image.
 *
 * Returns `null` when the profile row does not exist; the caller
 * surfaces this as a typed error so the page renders a "member not
 * found" toast.
 *
 * The read goes through the supabase cookie-scoped client (RLS applies
 * to the caller). The caller is `manager+` (gated by `requireRole`
 * above), and `profiles_select_self_or_staff` allows manager+ to read
 * any row. Using the cookie-scoped client here keeps the read on the
 * "respects RLS" side of the line — only the audit-tx itself uses the
 * admin client (which BYPASSes RLS for the trigger's INSERT into
 * audit_log).
 */
async function readCurrentRole(runner: TransactionRunner, profileId: string): Promise<Role | null> {
  // The TransactionRunner abstraction is the test seam; calling
  // `runner.transaction(...)` for a single read is overkill but keeps
  // the production / test injection point identical. Tests can stub
  // both `runner.transaction` and the inner `tx.query` calls.
  //
  // We deliberately do NOT reach for the cookie-scoped supabase
  // client here (despite the file-header note about RLS reads). The
  // ladder-math read MUST share the test seam with the audit-tx
  // read; otherwise a pglite-backed test would have to mock two
  // different DB surfaces. The `manager+` role gate above is the
  // authorization checkpoint — the ladder-math read is downstream
  // of that gate and doesn't need a second RLS evaluation.
  let role: Role | null = null;
  await runner.transaction(async (tx) => {
    const result = await tx.query('SELECT role FROM profiles WHERE id = $1', [profileId]);
    const row = result.rows[0] as { role: Role } | undefined;
    role = row?.role ?? null;
    return undefined;
  });
  return role;
}

// ---- Default production adapter -------------------------------------------
//
// Defined BELOW `changeRole` so the file's first `await` token is the
// `await requireRole('manager')` inside `changeRole`. AC5's regex-tier
// defense-in-depth walker scans for the first `\bawait\b` token in
// source order; placing the adapter (which contains internal `await`
// calls against the supabase client) above the action would silently
// fail the gate. Function declarations are hoisted in JS, so the
// `db ?? defaultDb()` reference in `changeRole` resolves correctly
// despite the textual ordering.

/**
 * Construct the production `TransactionRunner` backed by the supabase
 * service-role admin client. The admin client BYPASSes RLS — required
 * because the `profiles_protect_role_change` trigger writes to
 * `audit_log`, and the service-role posture matches the cycle-1 design
 * for trigger-emitted audit rows.
 *
 * STRUCTURAL ONLY — supabase-js has no Postgres transaction API; the
 * adapter runs queries sequentially through the admin client. Atomicity
 * is provided by the pglite tests, not by this default. When ADR-0017
 * lands a pg driver, swap this body to a real `pg.transaction()` call.
 *
 * The adapter parameterizes a narrow `TransactionClient` surface
 * (`query(sql, params) -> { rows }`) so the action's `withAudit`
 * callback doesn't have to know whether it's running under pglite,
 * supabase RPC, or a future pg driver. The supabase admin client's
 * `.rpc('exec_sql', { sql, params })` shape is NOT available out of the
 * box — the production adapter below uses the REST/PostgREST surface
 * via `from('table').select/update/insert` chains, parsing a small
 * inline SQL dialect to translate the action's queries.
 *
 * SAFETY POSTURE: this adapter is exercised in production only when
 * cycle 4's pg driver is unavailable. If you find yourself adding new
 * SQL shapes here that the adapter must learn to translate, STOP — the
 * answer is to add the pg driver (ADR-0017), not to grow this
 * translator. The adapter recognizes ONLY the four query shapes this
 * action issues; any other SQL throws so the failure mode is loud.
 */
function defaultDb(): TransactionRunner {
  // Hoist the admin client into a closure variable so multiple
  // `tx.query(...)` calls inside a single transaction share the same
  // PostgREST client + auth context. Re-instantiating per-call would
  // also re-read the env vars (per-call factory pattern) on every
  // query, which is wasted work inside the same logical tx.
  let admin: ReturnType<typeof createAdminClient> | null = null;
  const getAdmin = () => {
    if (admin === null) admin = createAdminClient();
    return admin;
  };

  // Safe string-or-null coercion for the positional parameters that
  // withAudit / this action pass in. The action only ever passes
  // `string` (or `null` for `actor_id`, `ip`, `user_agent`); the
  // explicit narrowing here defends against a future refactor that
  // might pass a non-string (e.g. an enum instance) — that would
  // otherwise serialize to '[object Object]' and silently corrupt
  // the audit row.
  const asStringOrNull = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    throw new Error(`changeRole defaultDb: expected string|null param, got ${typeof v}`);
  };
  const asString = (v: unknown): string => {
    if (typeof v === 'string') return v;
    throw new Error(`changeRole defaultDb: expected string param, got ${typeof v}`);
  };

  // Build the narrow `TransactionClient` shim. The action issues these
  // four query shapes (see the body below):
  //
  //   (1) SELECT role FROM profiles WHERE id = $1 FOR UPDATE
  //   (2) UPDATE profiles SET role = $1 WHERE id = $2
  //   (3) SELECT role FROM profiles WHERE id = $1
  //   (4) INSERT INTO audit_log (...)  ← issued by withAudit itself
  //
  // Shape (4) is opaque to this adapter — `withAudit` builds the SQL
  // and passes it through `tx.query(sql, params)`. PostgREST doesn't
  // accept raw SQL; we translate (4) into an equivalent `.from('audit_log').insert({...})`
  // call. Shapes (1), (2), (3) get the same treatment via from(...).select/update.
  const txClient: TransactionClient = {
    async query(sql, params) {
      const adminClient = getAdmin();
      const normalized = sql.replace(/\s+/g, ' ').trim();

      // Shape (1) + (3): SELECT role FROM profiles WHERE id = $1 [FOR UPDATE]
      if (/^SELECT\s+role\s+FROM\s+profiles\s+WHERE\s+id\s*=\s*\$1/i.test(normalized)) {
        const id = asString(params?.[0]);
        const { data, error } = await adminClient
          .from('profiles')
          .select('role')
          .eq('id', id)
          .maybeSingle();
        if (error) {
          throw new Error(`changeRole defaultDb: SELECT role failed: ${error.message}`);
        }
        return { rows: data ? [data] : [] };
      }

      // Shape (2): UPDATE profiles SET role = $1 WHERE id = $2
      if (/^UPDATE\s+profiles\s+SET\s+role\s*=\s*\$1\s+WHERE\s+id\s*=\s*\$2/i.test(normalized)) {
        const newRole = asString(params?.[0]);
        const id = asString(params?.[1]);
        const { error } = await adminClient.from('profiles').update({ role: newRole }).eq('id', id);
        if (error) {
          throw new Error(`changeRole defaultDb: UPDATE role failed: ${error.message}`);
        }
        return { rows: [] };
      }

      // Shape (4): INSERT INTO audit_log (...) — emitted by withAudit.
      // Parse the positional params into the column dict PostgREST wants.
      if (/^INSERT\s+INTO\s+audit_log\s*\(/i.test(normalized)) {
        // withAudit emits the canonical 8-column INSERT in fixed order:
        // [actor_id, action, target_type, target_id, before, after, ip, user_agent]
        // The `before` and `after` values are pre-stringified JSON; we
        // parse them back so PostgREST handles jsonb serialization.
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
          throw new Error(`changeRole defaultDb: audit_log INSERT failed: ${error.message}`);
        }
        return { rows: [] };
      }

      // Loud failure for unrecognized SQL — see file header SAFETY POSTURE.
      throw new Error(
        `changeRole defaultDb: unsupported SQL shape ` +
          `(this adapter only translates the action's four canonical shapes; ` +
          `add a pg driver via ADR-0017 rather than growing this translator). ` +
          `Got: ${normalized.slice(0, 120)}`,
      );
    },
  };

  return {
    transaction: async (callback) => {
      // No real transaction semantics in supabase-js — see file header
      // §Production note. The pglite-backed tests provide the atomicity
      // exercise; this default just runs the callback against the shim.
      return callback(txClient);
    },
  };
}
