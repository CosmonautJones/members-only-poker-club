/**
 * POST /api/privacy/delete — ADR-0023 slice 1, AC4.
 *
 * Authenticated members may anonymize only the profile identified by
 * auth.getUser(). The profile mutation and its PII-free audit record share
 * one Postgres transaction. Signing out remains post-commit.
 */

import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { postgresTransactionRunner } from '@/lib/db/postgres-transaction-runner';
import type { TransactionRunner } from '@/lib/db/transactions';
import { nowUtc } from '@/lib/time';

export async function deleteAccount(
  request: Request,
  db: TransactionRunner = postgresTransactionRunner,
): Promise<Response> {
  let supabase: ReturnType<typeof createClient>;
  try {
    supabase = createClient();
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const userId = user.id;
  const hash = createHash('sha256').update(userId).digest('hex');
  const fullNameToken = `del:${hash}`;
  const emailToken = `del:${hash}@deleted.local`;
  const deletedAt = nowUtc().toISOString();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = request.headers.get('user-agent') ?? null;

  let alreadyDeleted: boolean;
  try {
    alreadyDeleted = await db.transaction(async (tx) => {
      const update = await tx.query(
        `UPDATE profiles
            SET full_name = $2,
                email = $3,
                phone = NULL,
                deleted_at = $4
          WHERE id = $1
            AND deleted_at IS NULL
        RETURNING id`,
        [userId, fullNameToken, emailToken, deletedAt],
      );

      if (update.rows.length === 0) {
        return true;
      }

      await tx.query(
        `INSERT INTO audit_log
          (actor_id, action, target_type, target_id, before, after, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
        [
          userId,
          'privacy.account_deleted',
          'profile',
          userId,
          JSON.stringify({ deleted_at: null }),
          JSON.stringify({ deleted_at: deletedAt }),
          ip,
          userAgent,
        ],
      );

      return false;
    });
  } catch {
    // Never leak database details; they may include PII or stack traces.
    return Response.json({ error: 'internal' }, { status: 500 });
  }

  try {
    await supabase.auth.signOut();
  } catch {
    return Response.json({ error: 'internal' }, { status: 500 });
  }
  return Response.json({ ok: true, alreadyDeleted }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  return deleteAccount(request);
}
