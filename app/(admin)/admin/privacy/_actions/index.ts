'use server';

/**
 * `'use server'` re-export shim for the privacy queue Actions panel
 * (ADR-0035 AC23-26, WC.T17).
 *
 * Mirrors the pattern in `app/(admin)/admin/members/[id]/_actions/index.ts`.
 * The underlying action files import `'server-only'` and cannot be
 * bundled to the client; this shim carries the
 * `'use server'` directive and re-exports thin async wrappers the
 * client component can reference.
 *
 * AC5 defense-in-depth (load-bearing): each wrapper's FIRST `await`
 * MUST be `await requireRole('manager')` — this is a SECOND gate on
 * top of the underlying action's own first-await gate. The walker in
 * `tests/auth/admin-routes-defense-in-depth.test.ts` treats every file
 * in an `_actions/` directory as a gated action surface.
 */

import { requireRole } from '@/lib/auth/requireRole';

import { approveExport as _approveExport } from './approveExport';
import { approveDeletion as _approveDeletion } from './approveDeletion';
import { rejectRequest as _rejectRequest } from './rejectRequest';

export async function approveExportAction(params: {
  requestId: string;
}): Promise<{ ok: true; expiresAt: string }> {
  await requireRole('manager');
  return _approveExport(params);
}

export async function approveDeletionAction(params: {
  requestId: string;
  confirmEmail: string;
}): Promise<{ ok: true }> {
  await requireRole('manager');
  return _approveDeletion(params);
}

export async function rejectRequestAction(params: {
  requestId: string;
  reason: string;
}): Promise<{ ok: true }> {
  await requireRole('manager');
  return _rejectRequest(params);
}
