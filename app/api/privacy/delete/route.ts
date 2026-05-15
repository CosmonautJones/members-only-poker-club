/**
 * POST /api/privacy/delete — ADR-0023 slice 1, AC4.
 *
 * Destructive account anonymization endpoint. Authenticated members only.
 * Anonymizes the calling user's profile, writes an audit row, then signs
 * the user out.
 *
 * LOAD-BEARING SECURITY PROPERTIES — DO NOT WEAKEN:
 *
 * 1. User identity comes ONLY from the session client's auth.getUser() —
 *    NEVER from the request body. A request-body userId field would allow
 *    an attacker to anonymize any user.
 *
 * 2. Audit before/after snapshots MUST NOT contain PII (email, full_name,
 *    phone). The audit row survives forever per ADR-0006. Including PII
 *    defeats the anonymization. See AC13 / no-pii-in-audit.test.ts.
 *
 *    LOAD-BEARING LITERAL — the audit snapshots below are:
 *      before: { deleted_at: null }
 *      after:  { deleted_at: '<ISO timestamp>' }
 *    DO NOT add email, full_name, or phone keys to these objects.
 *
 * 3. On idempotent re-delete (.is('deleted_at', null) matches no row), the
 *    user is signed out but NO second audit row is written.
 *
 * Slice 1 path: anonymization runs through supabase-js admin client (no
 * pg driver yet — ADR-0017's server-side DB access is a future slice). The
 * SHA-256 hash that produces the anonymized token is computed in Node here
 * to match what lib/privacy/soft-delete.ts computes in Postgres via
 * pgcrypto on its pglite-backed test path — same input UUID string, same
 * output hex digest.
 */

import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request): Promise<Response> {
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

  let adminClient: ReturnType<typeof createAdminClient>;
  try {
    adminClient = createAdminClient();
  } catch {
    return Response.json({ error: 'internal' }, { status: 500 });
  }

  // Deterministic anonymization token. SHA-256 of the canonical UUID string
  // matches the pgcrypto path: encode(digest(id::text::bytea, 'sha256'), 'hex').
  const hash = createHash('sha256').update(userId).digest('hex');
  const fullNameToken = `del:${hash}`;
  const emailToken = `del:${hash}@deleted.local`;
  const deletedAt = new Date().toISOString();

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = request.headers.get('user-agent') ?? null;

  try {
    // Anonymize. .is('deleted_at', null) is the idempotency gate — second
    // call matches zero rows and maybeSingle returns null.
    const { data: updated, error: updateError } = await adminClient
      .from('profiles')
      .update({
        full_name: fullNameToken,
        email: emailToken,
        phone: null,
        deleted_at: deletedAt,
      })
      .eq('id', userId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();

    if (updateError) {
      return Response.json({ error: 'internal' }, { status: 500 });
    }

    if (updated === null) {
      // Already deleted (or profile doesn't exist). Sign out the stale
      // session anyway; do NOT write a second audit row.
      await supabase.auth.signOut();
      return Response.json({ ok: true, alreadyDeleted: true }, { status: 200 });
    }

    // Write the audit row. LOAD-BEARING: before/after carry ONLY deleted_at
    // timestamps. No email, full_name, or phone — see AC13.
    const { error: auditError } = await adminClient.from('audit_log').insert({
      actor_id: userId,
      action: 'privacy.account_deleted',
      target_type: 'profile',
      target_id: userId,
      // LOAD-BEARING: NO PII in these snapshots.
      before: { deleted_at: null },
      after: { deleted_at: deletedAt },
      ip,
      user_agent: userAgent,
    });

    if (auditError) {
      // Anonymization committed but audit failed. supabase-js has no
      // multi-statement transaction (Slice 2 lands a pg driver). The
      // profile IS anonymized; we still surface 500 so the caller knows
      // the overall operation didn't complete cleanly.
      return Response.json({ error: 'internal' }, { status: 500 });
    }

    await supabase.auth.signOut();

    return Response.json({ ok: true, alreadyDeleted: false }, { status: 200 });
  } catch {
    // Never leak the underlying error — it may contain PII or stack traces.
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
