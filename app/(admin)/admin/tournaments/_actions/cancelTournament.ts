import 'server-only';

import { revalidatePath, revalidateTag } from 'next/cache';
import { requireRole } from '@/lib/auth/requireRole';
import { postgresTransactionRunner } from '@/lib/db/postgres-transaction-runner';
import type { TransactionRunner } from '@/lib/db/transactions';
import { BadRequest, NoChange } from '@/app/(admin)/admin/_errors';

export interface CancelTournamentParams {
  tournamentId: string;
}

export interface CancelTournamentResult {
  ok: true;
}

export type { TransactionRunner };

interface TournamentBefore {
  id: string;
  status: 'scheduled' | 'registering' | 'live' | 'complete' | 'canceled';
  slug: string;
  source_template_id: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function cancelTournament(
  params: CancelTournamentParams,
  db: TransactionRunner = postgresTransactionRunner,
): Promise<CancelTournamentResult> {
  const { profile: actor } = await requireRole('manager');

  if (!UUID_RE.test(params.tournamentId)) {
    throw new BadRequest(`cancelTournament: invalid tournamentId (${params.tournamentId})`);
  }

  const before = await db.transaction(async (tx) => {
    const beforeRead = await tx.query(
      `SELECT id, status, slug, source_template_id
         FROM tournaments
        WHERE id = $1
          FOR UPDATE`,
      [params.tournamentId],
    );
    const row = beforeRead.rows[0] as TournamentBefore | undefined;
    if (!row) {
      throw new BadRequest(`cancelTournament: tournament not found (${params.tournamentId})`);
    }
    if (row.status === 'canceled') {
      throw new NoChange(`cancelTournament: tournament ${params.tournamentId} is already canceled`);
    }
    if (row.status === 'complete') {
      throw new BadRequest(
        `cancelTournament: tournament ${params.tournamentId} is already complete and cannot be canceled`,
      );
    }

    await tx.query("UPDATE tournaments SET status = 'canceled' WHERE id = $1", [
      params.tournamentId,
    ]);
    await tx.query(
      `INSERT INTO audit_log
        (actor_id, action, target_type, target_id, before, after)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        actor.id,
        'tournament.cancel',
        'tournament',
        params.tournamentId,
        JSON.stringify({ status: row.status, slug: row.slug }),
        JSON.stringify({ status: 'canceled', slug: row.slug }),
      ],
    );

    return row;
  });

  revalidatePath('/admin/tournaments');
  revalidatePath('/games');
  revalidatePath(`/games/${before.slug}`);
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
