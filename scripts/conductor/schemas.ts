import { z } from 'zod';

// 8 operational phases (bootstrap..cleanup) plus 3 terminal states
// (completed, aborted, escalated). Terminal states are written to
// status.json when a run ends; phases describe in-flight progress.
export const PHASES = [
  'bootstrap',
  'plan',
  'build',
  'integration',
  'document',
  'ship',
  'retrospective',
  'cleanup',
  'completed',
  'aborted',
  'escalated',
] as const;

export const StatusSchema = z.object({
  adr: z.string().regex(/^\d{4}$/),
  phase: z.enum(PHASES),
  started_at: z.string().datetime(),
  current_task_id: z.string().optional(),
  iter_count: z.number().int().nonnegative(),
  events_offset: z.number().int().nonnegative(),
  spec_path: z.string().optional(),
  escalation_reason: z.string().optional(),
});

export type Status = z.infer<typeof StatusSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  blockedBy: z.array(z.string()).default([]),
  risk: z.enum(['low', 'medium', 'high']),
  linked_adrs: z.array(z.string().regex(/^\d{4}$/)).default([]),
});

export const PlanSchema = z
  .object({
    spec_path: z.string(),
    tasks: z.array(TaskSchema).min(1),
  })
  .superRefine((plan, ctx) => {
    const ids = new Set(plan.tasks.map((t) => t.id));
    for (const task of plan.tasks) {
      for (const dep of task.blockedBy) {
        if (!ids.has(dep)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `task ${task.id} blockedBy references unknown task ${dep}`,
          });
        }
      }
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const taskById = new Map(plan.tasks.map((t) => [t.id, t]));
    const hasCycle = (id: string): boolean => {
      if (inStack.has(id)) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      inStack.add(id);
      const task = taskById.get(id);
      if (task) {
        for (const dep of task.blockedBy) {
          if (hasCycle(dep)) return true;
        }
      }
      inStack.delete(id);
      return false;
    };
    for (const task of plan.tasks) {
      if (hasCycle(task.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `blockedBy graph contains a cycle involving task ${task.id}`,
        });
        break;
      }
    }
  });

export type Plan = z.infer<typeof PlanSchema>;

export const ValidatorResultSchema = z.discriminatedUnion('pass', [
  z.object({
    pass: z.literal(true),
    summary_path: z.string(),
  }),
  z.object({
    pass: z.literal(false),
    failed_step: z.string(),
    first_error_loc: z.string(),
    summary_path: z.string(),
  }),
]);

export type ValidatorResult = z.infer<typeof ValidatorResultSchema>;

export const RoleSummarySchema = z.object({
  status: z.enum(['ok', 'blocked', 'context_exhausted', 'failed']),
  summary_path: z.string(),
  notes: z.string().optional(),
  files_touched: z.array(z.string()).default([]),
});

export type RoleSummary = z.infer<typeof RoleSummarySchema>;
