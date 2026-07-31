import 'server-only';

import { revalidatePath, revalidateTag } from 'next/cache';
import { requireRole } from '@/lib/auth/requireRole';
import { postgresTransactionRunner } from '@/lib/db/postgres-transaction-runner';
import type { TransactionRunner } from '@/lib/db/transactions';
import { BadRequest, NoChange } from '@/app/(admin)/admin/_errors';

export interface SetTemplateActiveParams {
  templateId: string;
  active: boolean;
}

export interface SetTemplateActiveResult {
  ok: true;
}

export type { TransactionRunner };

interface TemplateBefore {
  id: string;
  active: boolean;
  slug_prefix: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setTemplateActive(
  params: SetTemplateActiveParams,
  db: TransactionRunner = postgresTransactionRunner,
): Promise<SetTemplateActiveResult> {
  const { profile: actor } = await requireRole('manager');

  if (!UUID_RE.test(params.templateId)) {
    throw new BadRequest(`setTemplateActive: invalid templateId (${params.templateId})`);
  }

  await db.transaction(async (tx) => {
    const beforeRead = await tx.query(
      `SELECT id, active, slug_prefix
         FROM tournament_templates
        WHERE id = $1
          FOR UPDATE`,
      [params.templateId],
    );
    const before = beforeRead.rows[0] as TemplateBefore | undefined;
    if (!before) {
      throw new BadRequest(`setTemplateActive: template not found (${params.templateId})`);
    }
    if (before.active === params.active) {
      throw new NoChange(
        `setTemplateActive: template ${params.templateId} is already active=${params.active}`,
      );
    }

    await tx.query('UPDATE tournament_templates SET active = $2 WHERE id = $1', [
      params.templateId,
      params.active,
    ]);
    await tx.query(
      `INSERT INTO audit_log
        (actor_id, action, target_type, target_id, before, after)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        actor.id,
        'tournament_template.set_active',
        'tournament_template',
        params.templateId,
        JSON.stringify({ active: before.active }),
        JSON.stringify({ active: params.active }),
      ],
    );
  });

  revalidatePath('/admin/tournaments');
  revalidatePath('/games');
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
