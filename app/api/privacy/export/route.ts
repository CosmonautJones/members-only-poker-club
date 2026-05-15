/**
 * POST /api/privacy/export — ADR-0023 slice 1, AC5.
 *
 * Synchronous data-export endpoint. Returns a JSON file with all
 * currently-collectable data for the calling member.
 *
 * LOAD-BEARING SECURITY PROPERTIES — DO NOT WEAKEN:
 *
 * 1. Profile SELECT runs through the RLS-scoped SESSION client. RLS policy
 *    profiles_select_self_or_staff ensures the row belongs to the caller.
 *
 * 2. Audit-log SELECT uses the ADMIN client but with an explicit
 *    WHERE actor_id = user.id predicate. The admin client bypasses RLS
 *    (the existing audit_log_select_manager policy denies non-manager
 *    SELECTs), but the SQL-level predicate enforces caller-scope.
 *    DO NOT remove the WHERE predicate — dropping it turns this endpoint
 *    into a full audit-log dump accessible to any authenticated member.
 *
 * 3. Response headers: Content-Disposition makes the browser save as file;
 *    Cache-Control: private, no-store prevents edge caching of personal data.
 *
 * 4. Stripe / sentry / posthog keys are null placeholders in Slice 1.
 *    They ship as explicit nulls (not undefined) so the response shape is
 *    forward-compatible. ADRs 0009 / 0010 / 0014 / 0028 populate them
 *    in future slices.
 *
 * 5. No audit row is written for the export itself (read-only operation).
 */

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request): Promise<Response> {
  void request; // no request body needed — identity comes from session only

  // 1. Authenticate — get the calling user from the session client.
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

  // 2. Get the admin client for the audit-log query.
  let adminClient: ReturnType<typeof createAdminClient>;
  try {
    adminClient = createAdminClient();
  } catch {
    return Response.json({ error: 'internal' }, { status: 500 });
  }

  try {
    // 3. SELECT the caller's profile row via the RLS-scoped session client.
    //    RLS policy profiles_select_self_or_staff ensures this returns at
    //    most one row belonging to the caller.
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, dob, phone, email, role, created_at, updated_at, deleted_at')
      .eq('id', userId)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      // PGRST116 = "JSON object requested, multiple (or no) rows returned"
      // A deleted user may not have a visible profile row — treat as null.
      throw profileError;
    }

    // 4. SELECT the caller's audit-log rows via the ADMIN client.
    //    LOAD-BEARING: the WHERE actor_id = userId predicate is the safety
    //    property — do NOT remove it. The admin client bypasses RLS so the
    //    scope is enforced entirely by this SQL predicate.
    const { data: auditData, error: auditError } = await adminClient
      .from('audit_log')
      .select('id, action, target_type, target_id, before, after, ip, user_agent, created_at')
      .eq('actor_id', userId)
      .order('created_at', { ascending: true });

    if (auditError) {
      throw auditError;
    }

    const generatedAt = new Date().toISOString();

    const exportData = {
      generatedAt,
      schemaVersion: 1,
      profile: profileData ?? null,
      auditLog: auditData ?? [],
      // Deferred — populated in Slice 2 when ADR-0009 / 0010 / 0014 / 0028 ratify.
      stripe: null,
      sentry: null,
      posthog: null,
    };

    const body = JSON.stringify(exportData);

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="mopc-privacy-export-${userId}.json"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    // DO NOT leak the underlying error — it may contain PII or stack traces.
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
