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
 * Production defaults to the shared Postgres transaction runner, so the
 * locked reads, role mutation, trigger audit, and application audit commit
 * or roll back together. Tests inject the same runner seam with PGlite.
 *
 * See ADR-0035 §Role-change flow + AC15.
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import { ROLE_RANK, type Role } from '@/lib/auth/types';
import { withAudit } from '@/lib/audit/withAudit';
import { postgresTransactionRunner } from '@/lib/db/postgres-transaction-runner';
import type { TransactionRunner } from '@/lib/db/transactions';

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
 * Tests pass a PGlite-backed adapter; production uses the shared
 * Postgres transaction runner.
 */
export type { TransactionRunner } from '@/lib/db/transactions';

// ---- The action ------------------------------------------------------------

/**
 * Promote or demote a member's role. See file header for the full
 * contract. The `db` parameter is for test injection only — production
 * callers omit it so the shared Postgres runner is used.
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

  const runner = db ?? postgresTransactionRunner;

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
  // audit row (profile.role_change) both land atomically.
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
 * The caller is `manager+` (gated by `requireRole` above). The read uses
 * the shared transaction seam so production and PGlite exercise the same
 * SQL surface.
 */
async function readCurrentRole(runner: TransactionRunner, profileId: string): Promise<Role | null> {
  // The TransactionRunner abstraction is the test seam; calling
  // `runner.transaction(...)` for a single read is overkill but keeps
  // the production / test injection point identical. Tests can stub
  // both `runner.transaction` and the inner `tx.query` calls.
  //
  // The ladder-math read shares the test seam with the audit-tx read.
  // The `manager+` role gate above is the authorization checkpoint.
  let role: Role | null = null;
  await runner.transaction(async (tx) => {
    const result = await tx.query('SELECT role FROM profiles WHERE id = $1', [profileId]);
    const row = result.rows[0] as { role: Role } | undefined;
    role = row?.role ?? null;
    return undefined;
  });
  return role;
}
