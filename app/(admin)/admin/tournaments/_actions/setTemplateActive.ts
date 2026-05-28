import 'server-only';

/**
 * `setTemplateActive` — toggle a tournament_template's `active` flag.
 *
 * Per ADR-0037: deactivating a template stops the nightly materializer
 * from emitting new instances. Existing materialized instances are NOT
 * canceled — they keep their `status='scheduled'` until an admin cancels
 * each individually. To purge future instances at once, deactivate the
 * template AND cancel each individual upcoming instance.
 *
 * Production audit posture: this action follows the existing repo pattern
 * (best-effort audit-pairing via two supabase-js calls; not atomic until
 * the pg-driver work lands). The mutation succeeds first, then the audit
 * row is written; if the audit write fails, we log + throw so the failure
 * is loud. Same risk profile as `app/api/privacy/delete/route.ts` —
 * documented gap, tracked separately from this slice.
 */

import { revalidatePath, revalidateTag } from 'next/cache';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminClient } from '@/lib/supabase/admin';
import { BadRequest, NoChange } from '@/app/(admin)/admin/_errors';

export interface SetTemplateActiveParams {
  templateId: string;
  active: boolean;
}

export interface SetTemplateActiveResult {
  ok: true;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setTemplateActive(
  params: SetTemplateActiveParams,
): Promise<SetTemplateActiveResult> {
  const { profile: actor } = await requireRole('manager');

  if (!UUID_RE.test(params.templateId)) {
    throw new BadRequest(`setTemplateActive: invalid templateId (${params.templateId})`);
  }

  const supabase = createAdminClient();

  interface BeforeShape {
    id: string;
    active: boolean;
    slug_prefix: string;
  }
  const { data: beforeData, error: beforeErr } = await supabase
    .from('tournament_templates')
    .select('id, active, slug_prefix')
    .eq('id', params.templateId)
    .maybeSingle<BeforeShape>();
  if (beforeErr) {
    throw new Error(`setTemplateActive: SELECT failed: ${beforeErr.message}`);
  }
  if (!beforeData) {
    throw new BadRequest(`setTemplateActive: template not found (${params.templateId})`);
  }
  const before: BeforeShape = beforeData;
  if (before.active === params.active) {
    // No-op — refuse rather than write a confusing same-value audit row.
    throw new NoChange(
      `setTemplateActive: template ${params.templateId} is already active=${params.active}`,
    );
  }

  const { error: updErr } = await supabase
    .from('tournament_templates')
    .update({ active: params.active })
    .eq('id', params.templateId);
  if (updErr) {
    throw new Error(`setTemplateActive: UPDATE failed: ${updErr.message}`);
  }

  // Best-effort audit pairing — same posture as existing admin actions
  // (see ADR-0006 / ADR-0017 note in the file header).
  const { error: auditErr } = await supabase.from('audit_log').insert({
    actor_id: actor.id,
    action: 'tournament_template.set_active',
    target_type: 'tournament_template',
    target_id: params.templateId,
    before: { active: before.active },
    after: { active: params.active },
  });
  if (auditErr) {
    console.error(
      JSON.stringify({
        event: 'admin_action_audit_write_failed',
        action: 'tournament_template.set_active',
        target_id: params.templateId,
        message: auditErr.message,
      }),
    );
    throw new Error('setTemplateActive: audit write failed (mutation already applied)');
  }

  revalidatePath('/admin/tournaments');
  revalidatePath('/games');
  // ADR-0035 AC35: bust the admin-dashboard-counts tag in case a future
  // dashboard widget surfaces active-template counts. Harmless today.
  try {
    revalidateTag('admin-dashboard-counts');
  } catch (err) {
    console.warn('setTemplateActive: cache-invalidation-skipped', {
      templateId: params.templateId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true };
}
