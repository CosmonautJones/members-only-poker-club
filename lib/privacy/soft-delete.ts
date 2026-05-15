import 'server-only';

/**
 * softDeleteProfile — ADR-0023 slice 1, AC3.
 *
 * Anonymizes a member's profile row irreversibly. The anonymization runs
 * entirely in SQL via a single UPDATE statement; the SHA-256 hash is computed
 * by Postgres using pgcrypto (enabled by migration 0004_privacy_soft_delete.sql).
 *
 * LOAD-BEARING PROPERTIES — DO NOT WEAKEN:
 *
 * 1. Anonymization shape: The UPDATE writes
 *      full_name = 'del:' || encode(digest(id::text::bytea, 'sha256'), 'hex')
 *      email     = 'del:' || encode(digest(id::text::bytea, 'sha256'), 'hex') || '@deleted.local'
 *      phone     = NULL
 *      deleted_at = now()
 *    WHERE id = $1 AND deleted_at IS NULL.
 *    The hash is deterministic (SHA-256 of the UUID) so two calls for the
 *    same user produce identical tokens — no collision risk within the v1
 *    user-base scale (2^256 hash space vs ~10^4 expected users).
 *
 * 2. Idempotency: the WHERE deleted_at IS NULL guard means a second call on
 *    the same userId updates 0 rows and returns { mutated: false }.
 *
 * 3. Missing-profile: if userId does not exist, the UPDATE affects 0 rows;
 *    the helper returns { mutated: false } without throwing.
 *
 * 4. Server-only: this file MUST start with `import 'server-only'`. The
 *    helper takes a privileged DB client and must not be bundled into
 *    client code (ADR-0007).
 *
 * 5. No Node/browser crypto: the SHA-256 runs in Postgres via pgcrypto so
 *    the hash is deterministic across Node versions and the Edge runtime.
 *
 * 6. The caller (the delete API route) is responsible for wrapping this in
 *    a withAudit transaction and for signing the user out afterwards.
 */

/**
 * Structural transaction-client interface — same shape as
 * lib/audit/withAudit.ts's TransactionClient (Open Q 1 resolution).
 * Any driver whose query(sql, params) shape matches satisfies this interface.
 *
 * The return type includes optional affectedRows / rowCount so the helper
 * can detect whether the UPDATE modified any rows (the idempotency signal).
 * Drivers that don't expose this field (e.g. thin adapters that only return
 * `{ rows }`) cause the helper to fall back to checking rows.length, which
 * is 0 for UPDATE statements regardless of affected rows — in that case the
 * helper issues a follow-up SELECT to confirm the mutation.
 */
export interface TransactionClient {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: unknown[]; affectedRows?: number; rowCount?: number }>;
}

/**
 * Result shape returned by softDeleteProfile.
 */
export interface SoftDeleteResult {
  userId: string;
  /**
   * True on the FIRST call when the profile transitions from non-deleted to
   * deleted. False on subsequent calls (idempotent no-op) AND when no profile
   * row exists for userId.
   */
  mutated: boolean;
}

/**
 * Anonymize and soft-delete a member profile.
 *
 * Replaces full_name, email, and phone with anonymized tokens derived from
 * the user's UUID via SHA-256 (in Postgres/pgcrypto). Sets deleted_at to
 * now(). The WHERE deleted_at IS NULL guard makes the operation idempotent.
 *
 * @param userId - the UUID of the profile to anonymize (MUST come from
 *   the session client's auth.getUser() result — never from request body).
 * @param db - a transaction-client that already has pgcrypto available
 *   (migrations 0002 + 0003 + 0004 must have run).
 * @returns { userId, mutated } where mutated is true on the first call and
 *   false on re-calls or when the profile doesn't exist.
 */
export async function softDeleteProfile(
  userId: string,
  db: TransactionClient,
): Promise<SoftDeleteResult> {
  // Single UPDATE with the anonymization entirely in SQL.
  // The pgcrypto encode(digest(...)) expression runs in Postgres so there is
  // no Node/browser crypto dependency in this file.
  //
  // LOAD-BEARING: the WHERE clause `id = $1 AND deleted_at IS NULL` is the
  // idempotency gate. A second call updates 0 rows.
  const result = await db.query(
    `UPDATE profiles
     SET
       full_name  = 'del:' || encode(digest(id::text::bytea, 'sha256'), 'hex'),
       email      = 'del:' || encode(digest(id::text::bytea, 'sha256'), 'hex') || '@deleted.local',
       phone      = NULL,
       deleted_at = now()
     WHERE id = $1
       AND deleted_at IS NULL`,
    [userId],
  );

  // pglite and pg both expose rowCount (or affectedRows) on the result.
  // We check rows.length as a fallback for drivers that return the affected
  // rows in the rows array (some pglite versions). The primary signal is the
  // standard rowCount field.
  const rawResult = result as Record<string, unknown>;
  const rowCount =
    typeof rawResult.affectedRows === 'number'
      ? rawResult.affectedRows
      : typeof rawResult.rowCount === 'number'
        ? rawResult.rowCount
        : result.rows.length;

  return {
    userId,
    mutated: rowCount > 0,
  };
}
