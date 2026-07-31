import 'server-only';

/**
 * `openRefundFlow` — server action that emits an audit breadcrumb when a
 * manager clicks the "Open refund flow" button on the member-detail
 * Actions panel, then returns a redirect target. NO state mutation —
 * the breadcrumb is the whole point of this action (ADR-0035 AC17,
 * WC.T14).
 *
 * Contract (load-bearing — do not weaken):
 *
 *   1. **First runtime statement is `await requireRole('manager');`** —
 *      AC5 first-await defense-in-depth.
 *
 *   2. **Premortem R9 input validation** runs BEFORE `withAudit` opens
 *      its tx. AC18 specifies NO typed-confirmation UI for the refund-
 *      flow button (it's a redirect, not a mutation), so this action
 *      is the ONLY defense against a compromised manager session
 *      POSTing thousands of `admin.refund.flow_opened` rows against
 *      random profile ids for forensic noise.
 *        - `profileId` MUST be a well-formed UUID v4 (the canonical
 *          shape Supabase emits).
 *        - `profileId` MUST correspond to an existing profile row
 *          (`SELECT 1 FROM profiles WHERE id = $1`).
 *      Either check failing throws `BadRequest`. **NO audit row is
 *      written for a rejected attempt** — see `_errors.ts` for the
 *      forensic-posture rationale.
 *
 *   3. **NO state mutation** — the action emits a single audit
 *      breadcrumb via `withAudit('admin.refund.flow_opened', 'profile',
 *      profileId)` with `before = null`, `after = { scope }`. No
 *      `UPDATE` / `INSERT` against any non-`audit_log` table.
 *
 *   4. **Two redirect targets** keyed off `PAYMENTS_CONSOLE_READY`:
 *        - `true` (ADR-0036 has shipped + flipped the constant) →
 *          `/admin/payments/[id]/refund`.
 *        - `false` (the v1 default — see `lib/payments/console-availability.ts`)
 *          → `/admin/members/[id]?refund=pending-adr-0036`. The page
 *          renders a "refund flow not yet available — see ADR-0036
 *          (in flight)" toast based on the query parameter.
 *      The audit breadcrumb fires in **both** cases.
 *
 * Forensic note — why a breadcrumb at all:
 *   - Even before ADR-0036 ships, the audit log records the moment a
 *     manager intended to start a refund. That intent is operationally
 *     meaningful (e.g. for an inquiry about a contested charge) — the
 *     fact that the destination page hasn't shipped yet doesn't change
 *     the value of the breadcrumb.
 *   - `before = null` because there is no prior state — this is not a
 *     mutation, it's a navigation event being audited.
 *   - `after = { scope }` captures WHICH refund queue the manager
 *     intended (membership vs time-bank vs tournament-entry) so a
 *     future ADR-0036 audit-log viewer can group breadcrumbs by scope.
 *
 * Production defaults to the shared Postgres transaction runner. The
 * pre-validation probe and audit insert use the same injected runner
 * seam in production and tests.
 */

import { revalidateTag } from 'next/cache';

import { requireRole } from '@/lib/auth/requireRole';
import { withAudit } from '@/lib/audit/withAudit';
import { postgresTransactionRunner } from '@/lib/db/postgres-transaction-runner';
import type { TransactionRunner } from '@/lib/db/transactions';

import { BadRequest } from '@/app/(admin)/admin/_errors';
import { ADMIN_REFUND_FLOW_OPENED } from '@/lib/audit/actions';
import { PAYMENTS_CONSOLE_READY } from '@/lib/payments/console-availability';
import { trackAdminEvent } from '@/lib/analytics/admin-events';

// ---- Public types ---------------------------------------------------------

/**
 * Refund-flow scope. Captured in the audit `after` JSON so a future
 * ADR-0036 audit-log viewer can group breadcrumbs by intended queue.
 */
export type RefundScope = 'membership' | 'time_bank' | 'tournament_entry';

export interface OpenRefundFlowParams {
  profileId: string;
  scope: RefundScope;
}

export interface OpenRefundFlowResult {
  /**
   * Path the page should navigate to AFTER the audit breadcrumb is
   * persisted. The caller (a server component or a client-side form
   * action) is responsible for performing the navigation; this action
   * does NOT call `redirect()` itself so the audit-tx ordering stays
   * deterministic (the breadcrumb is the load-bearing side-effect, not
   * the navigation).
   */
  redirectTo: string;
}

/**
 * Shared transaction seam. Tests inject a PGlite-backed runner;
 * production uses the Postgres runner.
 */
export type { TransactionRunner } from '@/lib/db/transactions';

// ---- Validation constants -------------------------------------------------

/**
 * RFC 4122 UUID regex (case-insensitive). Matches v1..v5 — the migration
 * uses `gen_random_uuid()` (v4) but we accept all variants to avoid
 * false negatives against legacy seed data or future column types.
 *
 * Regex tier — Postgres + the supabase auth schema both store UUIDs as
 * 36-char hyphenated strings, so this is the right shape to validate
 * BEFORE issuing a SELECT that would otherwise return a generic
 * "invalid input syntax for type uuid" error (which would surface as a
 * confusing 500 rather than a clean BadRequest).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALID_SCOPES: ReadonlySet<RefundScope> = new Set<RefundScope>([
  'membership',
  'time_bank',
  'tournament_entry',
]);

// ---- The action ------------------------------------------------------------

/**
 * Emit an `admin.refund.flow_opened` audit breadcrumb + return the
 * redirect target.
 *
 * @param params.profileId — UUID of the target profile. MUST be
 *   well-formed AND correspond to an existing row (premortem R9).
 * @param params.scope — refund queue scope. Captured in audit `after`.
 * @param db — optional `TransactionRunner` for test injection. Omit in
 *   production.
 *
 * @throws BadRequest — when `profileId` is malformed OR does not
 *   correspond to an existing profile row OR `scope` is not a member
 *   of `RefundScope`. NO audit row is written for any of these cases.
 * @throws InsufficientRoleError — when the caller is not `manager+`.
 */
export async function openRefundFlow(
  params: OpenRefundFlowParams,
  db?: TransactionRunner,
): Promise<OpenRefundFlowResult> {
  // AC5 first-statement defense-in-depth.
  const { profile: actor } = await requireRole('manager');

  // Premortem R9 input validation — runs BEFORE the audit-tx opens so
  // a rejected attempt writes NO audit row. The forensic posture
  // (per `_errors.ts` BadRequest JSDoc) is: malformed input has no
  // operational meaning, the audit log carries operational truth, so
  // we refuse to dirty the log with rejected attempts.
  if (typeof params.profileId !== 'string' || !UUID_RE.test(params.profileId)) {
    throw new BadRequest('openRefundFlow: profileId is not a well-formed UUID');
  }
  if (!VALID_SCOPES.has(params.scope)) {
    throw new BadRequest(
      `openRefundFlow: scope must be one of membership|time_bank|tournament_entry (got ${params.scope})`,
    );
  }

  const runner = db ?? postgresTransactionRunner;

  // Premortem R9 existence check — verify the profile row exists
  // BEFORE the audit-tx opens. We run this through the SAME
  // transaction runner as the audit-tx so a pglite-backed test can
  // stub both surfaces via the single `db` parameter. The existence
  // check is its own (read-only) transaction; the audit-tx is opened
  // separately below.
  await runner.transaction(async (tx) => {
    const probe = await tx.query('SELECT 1 AS exists FROM profiles WHERE id = $1', [
      params.profileId,
    ]);
    if (probe.rows.length === 0) {
      throw new BadRequest(`openRefundFlow: profileId ${params.profileId} does not exist`);
    }
    return undefined;
  });

  // Audit breadcrumb. NO state mutation — `before = null`,
  // `after = { scope }`. The audit row IS the whole point of this
  // action; it fires in both PAYMENTS_CONSOLE_READY branches.
  await runner.transaction(async (tx) =>
    withAudit(
      tx,
      {
        action: ADMIN_REFUND_FLOW_OPENED,
        targetType: 'profile',
        targetId: params.profileId,
        actorId: actor.id,
      },
      // No SQL UPDATE — this is a breadcrumb, not a mutation. The
      // `mutate` callback simply returns the before/after/result
      // tuple. `before = null` per AC17's "no prior state"
      // contract; `after = { scope }` captures the manager's intent.
      // (Plain function, not async — the callback returns a Promise
      // already; an `async` modifier without an `await` inside is a
      // lint error per @typescript-eslint/require-await.)
      (_tx) =>
        Promise.resolve({
          before: null,
          after: { scope: params.scope },
          result: { ok: true as const },
        }),
    ),
  );

  // Post-tx cache invalidation (AC35). The refund breadcrumb is a
  // mutation-class side-effect (it INSERTs into audit_log), so the
  // dashboard's recent-activity panel needs to refresh. Wrapped in
  // try/catch so a Next-cache outage cannot retroactively roll back
  // the audit-tx commit (premortem R2). Per the t21 cross-cutting
  // dashboard-cache-invalidation source-grep, every mutation-class
  // admin action MUST contain this literal.
  try {
    revalidateTag('admin-dashboard-counts');
  } catch (err) {
    console.warn('openRefundFlow: cache-invalidation-skipped', {
      profileId: params.profileId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Branch on PAYMENTS_CONSOLE_READY. Per AC17: when ADR-0036 has
  // shipped + flipped the constant, the canonical path lives at
  // `/admin/payments/[id]/refund`. Until then, the page renders a
  // "refund flow not yet available" toast based on the query param.
  const redirectTo = PAYMENTS_CONSOLE_READY
    ? `/admin/payments/${params.profileId}/refund`
    : `/admin/members/${params.profileId}?refund=pending-adr-0036`;

  // ADR-0035 AC31 + premortem R4: emit `admin_action_attempted` AFTER
  // the audit-tx commits + the cache invalidation runs. Payload is
  // the action name + target_type + outcome — NO actor_id, NO
  // profile.id, NO email. Fire-and-forget; the helper internally
  // strips any forbidden keys AND swallows errors so a telemetry
  // outage cannot break the action.
  void trackAdminEvent('admin_action_attempted', {
    action: 'openRefundFlow',
    target_type: 'profile',
    outcome: 'ok',
  });

  return { redirectTo };
}
