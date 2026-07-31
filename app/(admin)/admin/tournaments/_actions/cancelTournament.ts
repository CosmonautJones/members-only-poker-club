import 'server-only';

/**
 * `cancelTournament` — set a tournament instance's status to `canceled`.
 *
 * Per ADR-0037: template-sourced tournaments MUST be canceled (not hard-
 * deleted) so the materializer's idempotency anchor still resolves to a
 * row on the next run, preventing immediate re-creation. One-off
 * tournaments (`source_template_id IS NULL`) can be hard-deleted by a
 * separate `deleteTournament` action — not implemented in this slice.
 *
 * Same best-effort audit-pairing posture as `setTemplateActive` and other
 * admin actions; see ADR-0006 + ADR-0017 follow-up.
 */

import { revalidatePath, revalidateTag } from 'next/cache';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminClient } from '@/lib/supabase/admin';
import { BadRequest, NoChange } from '@/app/(admin)/admin/_errors';

export interface CancelTournamentParams {
  tournamentId: string;
}

export interface CancelTournamentResult {
  ok: true;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function cancelTournament(
  params: CancelTournamentParams,
): Promise<CancelTournamentResult> {
  const { profile: actor } = await requireRole('manager');

  if (!UUID_RE.test(params.tournamentId)) {
    throw new BadRequest(`cancelTournament: invalid tournamentId (${params.tournamentId})`);
  }

  const supabase = createAdminClient();

  interface BeforeShape {
    id: string;
    status: 'scheduled' | 'registering' | 'live' | 'complete' | 'canceled';
    slug: string;
    source_template_id: string | null;
  }
  const { data: beforeData, error: beforeErr } = await supabase
    .from('tournaments')
    .select('id, status, slug, source_template_id')
    .eq('id', params.tournamentId)
    .maybeSingle<BeforeShape>();
  if (beforeErr) {
    throw new Error(`cancelTournament: SELECT failed: ${beforeErr.message}`);
  }
  if (!beforeData) {
    throw new BadRequest(`cancelTournament: tournament not found (${params.tournamentId})`);
  }
  const before: BeforeShape = beforeData;
  if (before.status === 'canceled') {
    throw new NoChange(`cancelTournament: tournament ${params.tournamentId} is already canceled`);
  }
  if (before.status === 'complete') {
    throw new BadRequest(
      `cancelTournament: tournament ${params.tournamentId} is already complete and cannot be canceled`,
    );
  }

  const { error: updErr } = await supabase
    .from('tournaments')
    .update({ status: 'canceled' })
    .eq('id', params.tournamentId);
  if (updErr) {
    throw new Error(`cancelTournament: UPDATE failed: ${updErr.message}`);
  }

  const { error: auditErr } = await supabase.from('audit_log').insert({
    actor_id: actor.id,
    action: 'tournament.cancel',
    target_type: 'tournament',
    target_id: params.tournamentId,
    before: { status: before.status, slug: before.slug },
    after: { status: 'canceled', slug: before.slug },
  });
  if (auditErr) {
    console.error(
      JSON.stringify({
        event: 'admin_action_audit_write_failed',
        action: 'tournament.cancel',
        target_id: params.tournamentId,
        message: auditErr.message,
      }),
    );
    throw new Error('cancelTournament: audit write failed (mutation already applied)');
  }

  revalidatePath('/admin/tournaments');
  revalidatePath('/games');
  revalidatePath(`/games/${before.slug}`);
  // ADR-0035 AC35: bust the admin-dashboard-counts tag in case a future
  // dashboard widget surfaces upcoming-tournament counts. Harmless today.
  try {
    revalidateTag('admin-dashboard-counts');
  } catch (err) {
    console.warn('cancelTournament: cache-invalidation-skipped', {
      tournamentId: params.tournamentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true };
}
