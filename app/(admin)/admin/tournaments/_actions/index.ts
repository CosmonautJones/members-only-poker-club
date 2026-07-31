'use server';

/**
 * `'use server'` re-export shim for the tournament admin Actions
 * (ADR-0037, mirrors the pattern in `app/(admin)/admin/privacy/_actions/index.ts`).
 *
 * The underlying action files import `'server-only'` + `createAdminClient`
 * and cannot be bundled to the client. This shim carries the
 * `'use server'` directive and re-exports thin wrappers the client
 * components reference (TemplateRow, TournamentRow).
 *
 * AC5 defense-in-depth (load-bearing): each wrapper's FIRST `await` MUST
 * be `await requireRole('manager')` — this is a SECOND gate on top of
 * the underlying action's own first-await gate. The walker in
 * `tests/auth/admin-routes-defense-in-depth.test.ts` treats every file
 * in an `_actions/` directory as a gated action surface.
 */

import { requireRole } from '@/lib/auth/requireRole';

import {
  setTemplateActive as _setTemplateActive,
  type SetTemplateActiveParams,
  type SetTemplateActiveResult,
} from './setTemplateActive';
import {
  cancelTournament as _cancelTournament,
  type CancelTournamentParams,
  type CancelTournamentResult,
} from './cancelTournament';

export type {
  SetTemplateActiveParams,
  SetTemplateActiveResult,
  CancelTournamentParams,
  CancelTournamentResult,
};

export async function setTemplateActive(
  params: SetTemplateActiveParams,
): Promise<SetTemplateActiveResult> {
  await requireRole('manager');
  return _setTemplateActive(params);
}

export async function cancelTournament(
  params: CancelTournamentParams,
): Promise<CancelTournamentResult> {
  await requireRole('manager');
  return _cancelTournament(params);
}
