import 'server-only';

/**
 * Database client interface that {@link withAudit} accepts and that its
 * {@link WithAuditMutateResult mutate} callback receives.
 *
 * Structural / driver-agnostic on purpose (Open Question §1 of the cycle 2
 * spec — Option A). Any driver whose `query(sql, params)` shape matches
 * (pglite under tests, `pg`-style connection in production, a thin
 * Supabase-server-client shim once cycle 3 lands `lib/supabase/{server,admin}.ts`)
 * will satisfy this interface without the helper depending on a concrete
 * SDK.
 *
 * The CALLER promotes a base client to a transaction (e.g.
 * `db.transaction(async (tx) => ...)`) and passes the resulting
 * tx-scoped client here. The `mutate` callback receives the SAME `tx`
 * client — it MUST run all of its reads and writes through this `tx`
 * so that the mutation and the audit-log INSERT share a single
 * transaction.
 */
export interface TransactionClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Parameters for {@link withAudit}. These describe the audit row that will
 * be written if the wrapped mutation succeeds.
 */
export interface WithAuditParams {
  /**
   * Action verb in dotted form (e.g. `'membership.cancel'`,
   * `'profile.role_change'`). Required.
   */
  action: string;

  /**
   * Target table-like name (e.g. `'membership'`, `'profile'`). Required.
   */
  targetType: string;

  /**
   * ID of the row being mutated, string-coerced (audit_log.target_id is
   * `text`). Required.
   */
  targetId: string;

  /**
   * Authenticated user id, or `null` for system / service-role actions
   * (e.g. Stripe webhook handlers, admin scripts).
   *
   * REQUIRED — the caller MUST decide explicitly. Typing this as
   * `string | null` (no `?`) prevents an "I forgot to pass actorId" bug
   * from silently writing a NULL-actor audit row that forensics later
   * misreads as a system action. See ADR-0006 + premortem risk #6.
   */
  actorId: string | null;

  /**
   * Client IP, as a single Postgres-`inet`-compatible string
   * (e.g. `'127.0.0.1'`, `'::1'`, `'203.0.113.5'`). Optional.
   *
   * The helper does NOT parse `X-Forwarded-For` chains — for chained
   * headers, the caller MUST extract the originating IP before passing
   * it in. Multi-IP strings (`'127.0.0.1, 10.0.0.1'`) are rejected by
   * the `inet` parser at INSERT time (SQLSTATE `22P02`), which — per the
   * one-transaction invariant — rolls the wrapped mutation back. See
   * premortem risk #10.
   */
  ip?: string;

  /**
   * Client user-agent string, stored verbatim. Optional.
   */
  userAgent?: string;
}

/**
 * Return shape of the {@link withAudit} `mutate` callback.
 *
 * `before` and `after` MUST be captured INSIDE the callback using the
 * provided `tx`, so they reflect the state at transaction time. Do NOT
 * pass values read outside the transaction — they may be stale by the
 * time the caller's transaction wrapper opens the transaction (see
 * premortem risk #8).
 *
 * Both `before` and `after` MUST be JSON-serializable:
 *   - Date objects become their ISO-string representation; if a specific
 *     format matters, call `.toISOString()` explicitly at the call site.
 *   - BigInt is NOT supported — cast to `string` at the call site.
 *   - `undefined` properties are dropped during JSON serialization; use
 *     `null` for explicit absence.
 *   - Circular references throw — flatten before passing.
 *
 * The helper performs a `JSON.stringify` check on the values returned by
 * `mutate` BEFORE issuing the audit INSERT, and throws
 * `TypeError('withAudit: before/after must be JSON-serializable')` on
 * failure. The TypeError propagates to the caller's transaction wrapper,
 * which rolls back (premortem risk #9).
 *
 * @template T The value the helper returns to the caller after commit.
 */
export interface WithAuditMutateResult<T> {
  /**
   * State BEFORE the mutation. Capture inside the `mutate` callback via
   * the provided `tx` (e.g. `SELECT ... FOR UPDATE` then capture the
   * row). Use `null` for INSERT events that have no prior state.
   */
  before: unknown;

  /**
   * State AFTER the mutation. Capture inside the `mutate` callback via
   * the provided `tx`, after performing the write. Use `null` for
   * DELETE events that have no resulting state.
   */
  after: unknown;

  /**
   * Value the helper returns to the caller on successful commit.
   */
  result: T;
}

/**
 * Run a state-changing operation atomically with an audit-log insert,
 * inside a transaction OWNED BY THE CALLER.
 *
 * CALLING CONVENTION — the caller MUST open the transaction and pass the
 * tx-scoped client to `withAudit`. The helper does NOT issue
 * `BEGIN` / `COMMIT` / `ROLLBACK` / `SAVEPOINT` itself. This matches the
 * idiomatic transaction API of pglite, supabase-js, node-postgres, and
 * most other Postgres drivers, where transactions are exposed as a
 * callback that yields a tx-scoped client.
 *
 * Caller pattern (production — supabase-js / pg pool):
 * ```ts
 *   await db.transaction(async (tx) =>
 *     withAudit(tx, params, async (tx) => {
 *       // ... reads + writes via tx ...
 *       return { before, after, result };
 *     }),
 *   );
 * ```
 *
 * Caller pattern (pglite tests):
 * ```ts
 *   await pg.transaction(async (tx) =>
 *     withAudit(tx, params, async (tx) => {
 *       // ... reads + writes via tx ...
 *       return { before, after, result };
 *     }),
 *   );
 * ```
 *
 * Ordering inside the caller-owned transaction (load-bearing — DO NOT
 * REORDER):
 *
 * ```
 *   <caller's BEGIN>
 *     mutate(tx)                  // caller's mutation, captures before/after
 *     INSERT INTO audit_log ...   // helper's audit row, in the SAME tx
 *   <caller's COMMIT or ROLLBACK on throw>
 * ```
 *
 * The helper does NOT catch any throw from `mutate` or from the audit
 * INSERT — propagation IS the rollback signal that the caller's
 * transaction wrapper relies on. The keystone safety property is
 * "a mutation cannot commit without its audit row" (premortem risks
 * #1, #2, #3).
 *
 * Forbidden implementation shapes (do NOT refactor toward these):
 *   - Issuing `BEGIN` / `COMMIT` / `ROLLBACK` / `SAVEPOINT` inside the
 *     helper. The CALLER owns the transaction.
 *   - Two separate transactions (one for the mutation, one for the
 *     audit INSERT) — even if both are awaited sequentially. Breaks
 *     atomicity.
 *   - `try/catch` around `mutate(tx)` or around the audit INSERT that
 *     swallows the error and lets the partial work commit. Breaks
 *     atomicity. (The pre-INSERT `JSON.stringify` try/catch below is
 *     ALLOWED because it converts a JS-side serialization error into a
 *     typed `TypeError` and re-throws — it does not swallow.)
 *   - Fire-and-forget audit INSERT (un-`await`ed promise, `void`-ed
 *     promise, `.catch(...)` that just logs). Breaks atomicity AND
 *     hides failures.
 *
 * Calling `withAudit` recursively from inside another `withAudit`'s
 * `mutate` callback is FORBIDDEN — the inner call would re-use the
 * outer's tx-scoped client and the audit semantics get tangled
 * (premortem risk #7). To write multiple audit rows in one transaction,
 * INSERT directly into `audit_log` via the provided `tx` inside
 * `mutate`.
 *
 * Capture `before` and `after` INSIDE the `mutate` callback via the
 * provided `tx` — values read outside the transaction may be stale by
 * the time the caller's transaction wrapper actually starts the
 * transaction (premortem risk #8).
 *
 * @example
 *   await db.transaction(async (tx) =>
 *     withAudit(
 *       tx,
 *       {
 *         action: 'profile.role_change',
 *         targetType: 'profile',
 *         targetId: profileId,
 *         actorId: session.user.id, // or null for system actions — required
 *         ip: req.clientIp ?? undefined,
 *         userAgent: req.headers['user-agent'] ?? undefined,
 *       },
 *       async (tx) => {
 *         const { rows: [before] } = await tx.query(
 *           'SELECT role FROM profiles WHERE id = $1 FOR UPDATE',
 *           [profileId],
 *         );
 *         await tx.query(
 *           'UPDATE profiles SET role = $1 WHERE id = $2',
 *           [newRole, profileId],
 *         );
 *         const { rows: [after] } = await tx.query(
 *           'SELECT role FROM profiles WHERE id = $1',
 *           [profileId],
 *         );
 *         return { before, after, result: { ok: true } };
 *       },
 *     ),
 *   );
 *
 * @template T  The value `mutate` returns under `result`; passed through
 *              by the helper to the caller on successful commit.
 *
 * @param tx      Transaction-scoped database client opened by the caller
 *                (pglite / `pg` / Supabase-shim). The helper does NOT
 *                issue BEGIN/COMMIT — the caller's transaction wrapper
 *                is responsible. The same client is handed to `mutate`.
 * @param params  Audit-row parameters. See {@link WithAuditParams}.
 * @param mutate  Callback that performs the state change and returns
 *                `{ before, after, result }`. Captured inside the
 *                caller's transaction. See {@link WithAuditMutateResult}.
 *
 * @returns The `result` field returned by `mutate`, after the audit
 *          INSERT succeeds. (The caller's transaction wrapper commits
 *          afterwards.)
 *
 * @throws TypeError if `before` or `after` (returned by `mutate`) are
 *         not JSON-serializable. The throw propagates to the caller's
 *         transaction wrapper, which rolls back.
 * @throws Any error thrown by `mutate` or by the audit INSERT itself —
 *         the helper does not catch. The caller's transaction wrapper
 *         rolls back; the caller sees the original error.
 */
export async function withAudit<T>(
  tx: TransactionClient,
  params: WithAuditParams,
  mutate: (tx: TransactionClient) => Promise<WithAuditMutateResult<T>>,
): Promise<T> {
  // ---------------------------------------------------------------------
  // CALLER-OWNS-TRANSACTION BODY. Straight-line, fully-awaited, no
  // try/catch around `mutate(tx)` or the audit INSERT.
  //
  // FORBIDDEN refactors (per AC6 / premortem risks #1, #2, #3):
  //   (a) issuing BEGIN/COMMIT/ROLLBACK/SAVEPOINT here — the caller
  //       owns the transaction;
  //   (b) try/catch around mutate or the audit INSERT that swallows
  //       the error;
  //   (c) any best-effort / fire-and-forget audit pattern.
  //
  // The ONLY try/catch in this helper wraps `JSON.stringify` below; it
  // converts a JS-side serialization error into a typed TypeError and
  // re-throws. It does NOT catch DB errors, and it does NOT swallow.
  // ---------------------------------------------------------------------

  const { before, after, result } = await mutate(tx);

  // Pre-INSERT serializability check on the freshly-returned snapshots.
  // `JSON.stringify` throws on BigInt and circular refs; converting that
  // into a TypeError at this point gives the caller a clear message
  // instead of relying on the driver's parameter-binding error path.
  // The throw propagates to the caller's transaction wrapper, which
  // rolls back. This try/catch is ALLOWED — it converts the error type
  // but does NOT swallow it (the catch re-throws).
  let beforeJson: string;
  let afterJson: string;
  try {
    beforeJson = JSON.stringify(before);
    afterJson = JSON.stringify(after);
  } catch {
    throw new TypeError('withAudit: before/after must be JSON-serializable');
  }
  if (beforeJson === undefined || afterJson === undefined) {
    // JSON.stringify returns `undefined` for values like `undefined`
    // itself or a function. Audit rows must be JSON values — refuse.
    throw new TypeError('withAudit: before/after must be JSON-serializable');
  }

  // DO NOT wrap in try/catch — see AC6 one-transaction invariant.
  // The caller's transaction wrapper rolls back on any throw.
  await tx.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, before, after, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::inet, $8)`,
    [
      params.actorId,
      params.action,
      params.targetType,
      params.targetId,
      beforeJson,
      afterJson,
      params.ip ?? null,
      params.userAgent ?? null,
    ],
  );

  return result;
}
